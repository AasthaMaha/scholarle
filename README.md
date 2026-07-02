# Scholar-E — AI Scholarship Coaching Workflow

Scholar-E is an AI coaching platform for **scholarships, college applications,
and internships**. It analyzes an opportunity, compares it against the student's
real profile, simulates reviewers, scores the draft, and assembles a coaching
package — **it coaches, it never ghostwrites, and it never invents student
facts.**

This document explains how the workflow runs end to end: every agent, what it
reads and writes, and how control flows (and branches) from one agent to the
next.

---

## 1. High-level architecture

```text
React frontend (frontend-react, TanStack Start)
        │   POST /api/analyze
        ▼
FastAPI server (server.py)  ──►  api/routes.py
        │                          • validates input
        │                          • builds the Chroma profile store
        ▼
LangGraph pipeline (graph/builder.py)
        │   a branched, multi-agent graph over a shared ApplicationState
        ▼
JSON response  ──►  rendered in the journey UI
```

* **LLM:** OpenAI `gpt-4o-mini`, `temperature=0.2` (`config.py`, `llm/client.py`).
* **Retrieval:** ChromaDB vector store over the student's profile text
  (`rag/store.py`), embedded with `OpenAIEmbeddings`.
* **Orchestration:** LangGraph `StateGraph` over `ApplicationState`
  (`state/application_state.py`) — a shared dict every node reads from and
  writes to.

The graph is **not linear**. Agents run only when they can add value, decided by
four branch points (entry, fan-out, reviewer gate, critic loop).

---

## 2. The full workflow at a glance

```mermaid
flowchart TD
    START([POST /api/analyze]) --> ENTRY{route_entry\nis there real content?}

    ENTRY -- "empty / placeholder" --> INSUF[insufficient_input\nzero-LLM short-circuit]
    INSUF --> ASM

    ENTRY -- "has draft or profile" --> AN[analyze_opportunity\nAnalyzer agent]
    AN --> RET[retrieve_profile\nRetriever agent]
    RET --> PREP[prepare_context\nshared grounding]

    PREP --> FAN{route_generators\nconditional fan-out}

    FAN -- always --> STR[strategy_agent]
    FAN -- always --> ELI[eligibility_agent]
    FAN -- if profile --> DIS[discovery_agent]
    FAN -- if draft --> NAR[narrative_agent]
    FAN -- if draft --> SEC[coach_sections]

    STR --> JOIN[post_generation\njoin]
    ELI --> JOIN
    DIS --> JOIN
    NAR --> JOIN
    SEC --> JOIN

    JOIN --> GATE{route_after_generation\nis there a draft?}
    GATE -- yes --> REV[reviewer_agent\n4 persona simulation]
    GATE -- no --> COMB
    REV --> COMB[combine_coaching\nCombiner agent]

    COMB --> CRIT[critic_review\nCritic agent]
    CRIT --> AFTER{route_after_critic\nneeds revision?}
    AFTER -- "revise (max 1 retry)" --> COMB
    AFTER -- done --> ASM[assemble_package\nmarkdown package]
    ASM --> END([JSON response])
```

---

## 3. The shared state (`ApplicationState`)

Every node receives the state and returns a partial dict that is merged back in.
Key fields, grouped by who writes them:

| Field | Written by | Purpose |
| --- | --- | --- |
| `opportunity_text`, `student_draft`, `student_profile_docs`, `previous_readiness`, `draft_number` | API (input) | The raw submission |
| `opportunity_analysis` | Analyzer | Structured opportunity facts |
| `retrieved_profile_chunks` | Retriever | Profile evidence from Chroma |
| `shared_context`, `profile_text`, `submitted_summary` | prepare_context | One grounded context string reused by all generators |
| `strategy_report` | strategy_agent | What the opportunity really evaluates |
| `eligibility_report` | eligibility_agent | Raw requirement-by-requirement comparison |
| `discovery_report` | discovery_agent | Strengths grounded in the profile |
| `narrative_report` | narrative_agent | Story-construction feedback |
| `section_coaching` | coach_sections | Section-by-section essay feedback |
| `reviewer_report` | reviewer_agent | Four reviewer-persona comments |
| `readiness_index`, `coaching_brief`, `growth_report`, `reviewer_comments`, `coaching_reports`, `eligibility_matrix`, `feedback`, `revision_priorities`, `scores` | combine_coaching | Consumer-facing synthesis |
| `essay_alignment_matrix` | Essay Alignment Matrix | Checks whether the current essay draft covers the prompt, themes, criteria, length guidance, and profile-grounded evidence |
| `critique`, `critic_attempts`, `needs_revision` | critic_review | Quality audit + loop control |
| `final_application_package` | assemble_package | Final markdown package |

---

## 4. Agent-by-agent walkthrough

### Branch point 0 — `route_entry` (entry router)
**File:** `nodes/routing.py` · **LLM:** no

Before spending any tokens, the graph checks whether the submission has real
content. If there is **no draft** (`< 20` words) **and no profile**
(`< 15` words), it routes to `insufficient_input`. Otherwise it starts the real
pipeline at `analyze_opportunity`.

> This is the first strategic `if`: it protects against empty/placeholder
> submissions making LLM calls.

---

### `insufficient_input` (short-circuit node)
**File:** `nodes/insufficient.py` · **LLM:** no

Returns a complete, honest result with zero scores, a "add your draft and
profile, then run again" coaching message, and an empty eligibility matrix. Then
jumps straight to `assemble_package`. No agent runs.

---

### Agent 1 — Analyzer (`analyze_opportunity`)
**File:** `graph/builder.py` · **LLM:** yes

Reads `opportunity_text` and extracts structured JSON:

* `opportunity_type`
* `requirements`
* `deadlines`
* `evaluation_themes`

**Writes** `opportunity_analysis`. This both feeds retrieval queries and seeds
the eligibility matrix downstream.

---

### Agent 2 — Retriever (`retrieve_profile`)
**File:** `graph/builder.py` + `rag/retrieve.py` + `rag/store.py` · **LLM:** embeddings only

Builds search queries from the analyzer's `requirements` + `evaluation_themes`
(plus the draft, or the opportunity text as a fallback), then runs similarity
search against the student's **Chroma profile store**. Deduplicates and caps the
results.

**Writes** `retrieved_profile_chunks` — the grounded evidence every later agent
is allowed to cite. (The profile store is built per-profile in
`api/routes.py`, ephemeral in-memory for new profiles to avoid Windows file
locks.)

---

### `prepare_context` (grounding node)
**File:** `nodes/prepare.py` · **LLM:** no

Assembles **one** shared context string so the expensive concatenation happens
once instead of inside every agent. It combines:

* the opportunity text + analysis,
* a verbatim `submitted_summary` (exact word counts + raw text, from
  `utils/input_validation.py`),
* the profile evidence (retrieved chunks, or raw CV text as fallback),
* the student draft.

**Writes** `shared_context`, `profile_text`, `submitted_summary`. Every
generation agent reads `shared_context` and the shared **grounding rules**
(`nodes/coaching/agents.py::_grounding_rules`) that forbid inventing facts.

---

### Branch point 1 — `route_generators` (conditional fan-out)
**File:** `nodes/routing.py` · **LLM:** no

Returns the list of generation agents to run **in parallel**, based on what was
submitted:

| Agent | Runs when |
| --- | --- |
| `strategy_agent` | always |
| `eligibility_agent` | always |
| `discovery_agent` | profile has ≥ 15 words |
| `narrative_agent` | draft has ≥ 20 words |
| `coach_sections` | draft has ≥ 20 words |

> Second strategic `if`: a profile-only submission runs just strategy +
> eligibility + discovery; a draft-only submission skips discovery; both skip
> nothing they can actually use.

---

### Agent 3 — Opportunity Strategy (`strategy_agent`)
**File:** `nodes/generation.py` → `run_strategy_coach` · **LLM:** yes

Explains what the opportunity *actually* evaluates vs. what students think it
asks. **Writes** `strategy_report` with `surface_prompt`,
`actual_evaluation_focus`, `strategic_insight`, `reflection_vs_story_ratio`.
This output is later fed into the reviewer simulation.

---

### Agent 4 — Eligibility / Requirements Matrix (`eligibility_agent`)
**File:** `nodes/generation.py` → `run_eligibility_matrix` · **LLM:** yes

Builds a **row-per-requirement comparison** of the opportunity's rules against
the student's profile, grounded only in submitted text. Each row gets a status:

* `met` — the profile clearly satisfies it,
* `not_met` — the profile clearly **violates** it (e.g. requires 3.0 GPA,
  profile shows 2.4),
* `missing` — the requirement exists but the profile lacks the info to verify
  it (the student must fill it in).

**Writes** `eligibility_report`. The combiner later normalizes this into
`eligibility_matrix` with violation/missing/met counts, which the UI surfaces
prominently (red for violations, amber for missing, with a "what to fill in"
action per row).

### Application Readiness Matrix
**File:** `nodes/readiness_matrix.py` · **LLM:** no

The dedicated scholarship fit flow also creates an **Application Readiness
Matrix** from the fit agent's eligibility checks and required-material checks.
It answers: do we have the required eligibility evidence and application
materials ready?

This matrix is separate from the essay-writing review. It includes each
eligibility item or material, readiness status, risk level, evidence, action
needed, blockers, and preparation tasks. It is returned by `/api/fit/analyze`
as `application_readiness_matrix` and displayed in the scholarship fit step.

---

### Agent 5 — Experience Discovery (`discovery_agent`)
**File:** `nodes/generation.py` → `run_discovery_coach` · **LLM:** yes

Identifies strengths **only** from the profile text (says so if the profile is
empty). **Writes** `discovery_report` with `hidden_strengths`,
`strongest_match_for_opportunity`, `underused_experiences`,
`recommended_experience_to_feature`, `coaching_message`.

---

### Agent 6 — Narrative Coach (`narrative_agent`)
**File:** `nodes/generation.py` → `run_narrative_coach` · **LLM:** yes

Evaluates story construction in the **draft only**: beginning / middle / end /
reflection, plus the single biggest narrative gap. **Writes** `narrative_report`.

---

### Agent 7 — Section Coaching (`coach_sections`)
**File:** `nodes/coach_sections.py` · **LLM:** yes (one batched call)

Generates section-by-section feedback for configured templates (Personal
Statement, Leadership & Impact, Experience & Achievements) in a single LLM call.
**Writes** `section_coaching`.

---

### `post_generation` (join node)
**File:** `nodes/routing.py` · **LLM:** no

A pass-through join so the variable set of parallel generators fans back in to a
single point before the reviewer gate. Handles partial fan-in correctly (e.g.
only 2 of 5 generators ran).

---

### Branch point 2 — `route_after_generation` (reviewer gate)
**File:** `nodes/routing.py` · **LLM:** no

> Third strategic `if`: reviewer simulation only makes sense when there is an
> actual draft to react to. If there's a draft → `reviewer_agent`; otherwise skip
> straight to `combine_coaching`.

---

### Agent 8 — Reviewer Simulation (`reviewer_agent`)
**File:** `nodes/generation.py` → `run_reviewer_simulation_coach` · **LLM:** yes

Simulates **four reviewer personas** reacting to the draft — Scholarship
Reviewer, Admissions Officer, Recruiter, and a Skeptical Reviewer — using the
strategy agent's output as context. **Writes** `reviewer_report`.

---

### Agent 9 — Combiner (`combine_coaching`)
**File:** `nodes/combine.py` → `run_combiner` · **LLM:** yes (+ Python synthesis)

The synthesis hub. It:

1. Calls the LLM to produce the **Application Readiness Index** (5 dimensions:
   opportunity fit, evidence strength, narrative quality, authenticity,
   competitiveness) and a **coaching brief**, grounded in the submitted text.
2. Normalizes scores → levels (`nodes/coaching/readiness.py`).
3. Computes the **Growth Report** in pure Python by diffing this draft's
   readiness against `previous_readiness` (no LLM).
4. Normalizes the eligibility report into `eligibility_matrix` with
   violation/missing/met counts and explicit "violations" and "missing_info"
   lists.
5. Flattens reviewer comments and assembles `revision_priorities` + overall
   `scores`.

**If the Critic requested a revision**, the combiner re-runs with the
`critique` injected into its prompt so it can fix the flagged issues.

---

### Agent 10 — Critic (`critic_review`)
**File:** `nodes/critic.py` → `run_critic_review` · **LLM:** yes

A strict quality-control auditor (it does **not** coach the student). It audits
the combined output against the submitted text and the grounding rules:

* Is every readiness score justified by specific words in the submission?
* Did any agent invent experiences, awards, metrics, or facts?
* Is placeholder content (e.g. "N/A") correctly scored low, not praised?
* Are comments specific to this submission rather than generic praise?

**Writes** `critique` (`verdict`, `confidence`, `grounding_pass`,
`guardrail_pass`, `issues`, `revision_guidance`, `attempt`), plus
`critic_attempts` and `needs_revision`.

---

### Essay Alignment Matrix
**File:** `nodes/essay_alignment.py` · **LLM:** no

After the critic approves the coaching synthesis, Scholar-E runs an **Essay
Alignment Matrix** over the current draft. It does not rewrite the essay and
does not invent student experiences. It checks whether the draft responds to
the prompt, required themes, selection criteria, profile-grounded evidence, and
word-limit guidance.

The output includes overall alignment status, completion percent, word count,
word-limit status, requirement-by-requirement rows, missing or weak items,
supported strengths, revision tasks, and final submission readiness. The UI
shows it in the Essay Workspace and Application Evaluation areas.

The two matrices serve different jobs:

| Matrix | Main question | Runs in |
| --- | --- | --- |
| Application Readiness Matrix | Are eligibility evidence and required materials ready? | Scholarship fit flow |
| Essay Alignment Matrix | Does this essay draft answer what the scholarship asks for? | Essay/application coaching flow |

---

### Branch point 3 — `route_after_critic` (bounded revision loop)
**File:** `graph/builder.py` · **LLM:** no

> Fourth strategic `if`: if the critic flagged a real problem **and** we are
> still within the retry budget (`MAX_CRITIC_ATTEMPTS = 2`), loop back to
> `combine_coaching` with the critique. Otherwise proceed to `assemble_package`.
> The bound guarantees termination.

---

### `assemble_package` (final node)
**File:** `nodes/assemble_package.py` · **LLM:** no

Renders everything into a single markdown coaching package: coaching brief,
readiness index table, **eligibility & requirements matrix**, **essay alignment
matrix**, growth across drafts, reviewer simulation, coach reports, opportunity
analysis, retrieved evidence, section coaching, and the critic's quality check.
**Writes** `final_application_package`.

The API (`api/routes.py`) then returns the consumer-facing fields as JSON.

---

## 5. Why the flow branches (summary of the four `if`s)

| Branch point | Decision | Effect |
| --- | --- | --- |
| `route_entry` | Real content submitted? | Skip the entire LLM pipeline for empty input |
| `route_generators` | Profile? Draft? | Run only the generation agents that have usable input |
| `route_after_generation` | Draft present? | Run reviewer simulation only when there's a draft |
| `route_after_critic` | Revision needed & budget left? | Self-correct once, then finish |

This keeps the system efficient (no wasted agent calls) and adaptive (the path
changes with what each student actually submits).

---

## 6. Grounding & guardrails

* **Shared grounding rules** (`nodes/coaching/agents.py::_grounding_rules`) are
  injected into every generation/critic prompt: read the submitted text exactly,
  justify every score with specific words, score placeholders low, never invent
  facts or assume unstated profile details.
* **Input validation** (`api/routes.py`) caps field lengths to bound token use.
* **The Critic agent** is an explicit guardrail that can force one revision pass.
* **The eligibility matrix** explicitly reports where the profile *violates* a
  requirement or is *missing* information, so the student knows exactly what to
  fix.

---

## 7. Running it

**Backend**

```bash
pip install -r requirements.txt
# .env at project root:
#   OPENAI_API_KEY=sk-...
#   DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/scholare
#   CHROMA_PERSIST_DIRECTORY=./chroma_db
python server.py            # http://127.0.0.1:8000  (POST /api/analyze, GET /health)
```

**Frontend**

```bash
cd frontend-react
npm install
npm run dev                 # http://localhost:8080  (proxies /api to :8000)
```

Open the app, create an account (or "Fill demo details" / "Load example"), paste
a draft and scholarship details, and run the coach. The readiness scores,
eligibility matrix, reviewer comments, and critic quality check appear in the
journey UI.

### Persistence setup

Scholar-E now has a PostgreSQL-ready persistence layer for durable user data,
agent runs, version history, and future RAG memory. The current UI still works
without PostgreSQL; when `DATABASE_URL` is set, current agent routes write
`agent_runs` through the shared persistence wrapper.

Recommended local database setup:

```bash
createdb scholare
set DATABASE_URL=postgresql+psycopg2://user:password@localhost:5432/scholare
alembic upgrade head
python scripts/seed_demo_data.py
```

Storage rules:

* PostgreSQL is the source of truth for structured records.
* Chroma is only for searchable embedded chunks.
* Private memory must always carry `user_id` and explicit collection filters.
* Do not put `.env`, `chroma_db/`, `uploads/`, `local_data/`, SQLite files, or
  local database files in git.
* The shared `VectorService` contract is the path for new durable RAG features;
  agents should not invent one-off retrieval paths.
* Current endpoints remain backward compatible; `user_id` is optional until the
  auth layer is implemented, and defaults to the local demo user.

---

## 8. Project structure (current)

```text
.
├── server.py                     # FastAPI app: /health, POST /api/analyze
├── config.py                     # Settings + .env (model, OpenAI key, Chroma path)
├── api/
│   └── routes.py                 # Request validation, profile store, pipeline runner
├── graph/
│   └── builder.py                # LangGraph wiring + Analyzer/Retriever + routers
├── state/
│   └── application_state.py      # ApplicationState (shared state schema)
├── nodes/
│   ├── routing.py                # Branch logic (entry, fan-out, gate, join)
│   ├── insufficient.py           # Zero-LLM short-circuit
│   ├── prepare.py                # Shared grounded context
│   ├── generation.py             # strategy / eligibility / discovery / narrative / reviewer nodes
│   ├── coach_sections.py         # Section-by-section coaching (batched)
│   ├── combine.py                # Combiner synthesis + eligibility matrix + growth
│   ├── critic.py                 # Critic audit + revision loop control
│   ├── assemble_package.py       # Final markdown package
│   └── coaching/
│       ├── agents.py             # All LLM agent prompts (strategy, eligibility, ...)
│       └── readiness.py          # Score normalization + growth report (no LLM)
├── rag/
│   ├── store.py                  # Chroma vector store (persistent / ephemeral)
│   └── retrieve.py               # Similarity retrieval + dedupe
├── llm/
│   └── client.py                 # OpenAI client (gpt-4o-mini)
├── utils/
│   ├── parsing.py                # safe JSON parsing of LLM output
│   └── input_validation.py       # Verbatim submission summary
├── templates/                    # Section coaching prompt templates
└── frontend-react/               # React + TanStack Start UI
```
