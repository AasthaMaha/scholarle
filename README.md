## Setup

1. Create / activate your environment, then install dependencies:

```bash
pip install -r requirements.txt
```

2. Add a `.env` file at the project root.
3. ``` conda activate <your_virtual_enviroment>```
4. ``` cd ./frontend-react ```
5. ``` npm run dev ```



# Scholar-E UI-to-Backend Workflow

Scholar-E is an AI scholarship coaching application. The user works through a
React journey UI, and the backend provides profile extraction, scholarship
extraction, fit analysis, essay outlining, essay coaching, rewriting, and full
application evaluation.

This README explains the current workflow from the UI to the backend, focusing
on the folders and files actively used in the app.

---

## 1. Main Frontend Entry Point

The main user journey lives in:

```text
frontend-react/src/routes/journey.tsx
```

This file owns the screens for:

- profile creation
- resume autofill
- scholarship discovery and extraction
- scholarship fit analysis
- personalized outline generation
- essay workspace
- writing coach
- evaluation and highlights

The UI calls frontend API helpers from:

```text
frontend-react/src/lib/api/scholarE.ts
```

That file builds request payloads and sends `fetch()` requests to the FastAPI
backend.

---

## 2. Frontend Dev Server Starts Backend

The frontend dev server lazy-starts FastAPI from:

```text
frontend-react/vite.config.ts
```

When the UI calls `/api/...`, Vite starts:

```text
server.py
```

The backend runs at:

```text
http://127.0.0.1:8000
```

The Python resolver in `vite.config.ts` supports Windows, Conda, and local
virtual environments so the backend starts with the correct Python interpreter.

---

## 3. Backend Route Layer

The backend entry point is:

```text
server.py
```

`server.py` registers FastAPI endpoints and delegates work to:

```text
api/routes.py
```

Important endpoints:

```text
POST /api/profile/autofill-resume
POST /api/opportunity/extract
POST /api/fit/analyze
POST /api/apply/generate-outline
POST /api/apply/coaching-session
POST /api/apply/editor-check
POST /api/apply/rewrite-selection
```

`server.py` is intentionally thin. Most validation, request shaping, and
workflow orchestration starts in `api/routes.py`.

---

## 4. Profile Autofill

The profile autofill flow starts in the UI when the student uploads a resume.

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
```

Frontend function:

```ts
autofillProfileFromResume(file)
```

Backend endpoint:

```text
POST /api/profile/autofill-resume
```

Backend function:

```python
autofill_profile_from_resume(...)
```

Location:

```text
api/routes.py
```

The backend extracts text from the uploaded PDF, then uses:

```text
graph/profile_builder.py
nodes/profile_extraction.py
```

to produce editable student profile fields.

The extracted profile may be persisted through:

```text
persistence/services.py
persistence/database.py
```

Local persistence uses SQLite:

```text
DATABASE_URL=sqlite:///scholar_e.db
```

---

## 5. Scholarship Discovery Wiki

The Scholarship Discovery Wiki flow starts after the student has profile
information available. The user clicks Search in the discovery step, and
Scholar-E recommends scholarship platforms, source pages, specific
opportunities, funding categories, and search queries that match the profile.

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
```

Frontend functions:

```ts
buildWikiPayload(user)
discoverScholarshipWiki(payload)
```

Backend endpoint:

```text
POST /api/wiki/discover
```

Backend function:

```python
discover_scholarship_wiki(...)
```

Location:

```text
api/routes.py
```

The backend loads the curated scholarship source library, combines it with the
student profile, and runs:

```text
graph/wiki_builder.py
nodes/wiki_discovery.py
state/wiki_state.py
```

The Wiki discovery graph runs these nodes in order:

```text
platform_source_agent
specific_open_source_agent
wiki_output_cleaner_agent
```

The output includes:

- profile summary used for discovery
- missing profile fields that would improve recommendations
- top free scholarship platforms
- specific scholarship opportunities or official source pages
- funding categories
- personalized search queries

The UI displays the recommendations in the discovery step. When the user picks
a real opportunity from the Wiki, Scholar-E carries that scholarship name, link,
and notes into the requirements step so the extraction flow can fetch and
structure the official scholarship details.

---

## 6. Scholarship Extraction

The scholarship extraction flow starts after the user enters a scholarship name,
link, or copied description.

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
```

Frontend function:

```ts
extractScholarshipOpportunity(payload)
```

Backend endpoint:

```text
POST /api/opportunity/extract
```

Backend function:

```python
extract_scholarship_opportunity(...)
```

Location:

```text
api/routes.py
```

Before calling the extraction agent, the backend gathers source text with:

```python
_gather_opportunity_source_text(...)
```

That function tries to:

- use a complete pasted URL
- treat broken URLs as search clues
- discover likely URLs from scholarship name and notes
- fetch source page text
- fall back to user-provided notes if online fetch fails

Then the extraction graph runs:

```text
graph/opportunity_builder.py
nodes/opportunity_extraction.py
```

The extractor fills structured fields such as:

- scholarship name
- organization
- official website
- award amount
- deadlines
- eligibility
- required materials
- selection criteria
- application process
- missing fields

The UI displays structured editable fields. It does not show raw extraction
output or important notes.

---

## 7. Scholarship Fit Analysis

Fit analysis compares the cleaned scholarship record against the student
profile.

Frontend function:

```ts
analyzeScholarshipFit(payload)
```

Backend endpoint:

```text
POST /api/fit/analyze
```

Backend function:

```python
analyze_scholarship_fit(...)
```

Location:

```text
api/routes.py
```

The backend invokes:

```text
graph/fit_builder.py
```

The result includes:

- fit label
- fit score
- likely eligibility
- strengths
- gaps or risks
- missing student information
- application readiness matrix

---

## 8. Personalized Outline

The personalized outline helps the student plan an essay from their profile and
the scholarship requirements.

Frontend function:

```ts
generatePersonalizedOutline(buildOutlinePayload(user))
```

Backend endpoint:

```text
POST /api/apply/generate-outline
```

Backend function:

```python
generate_personalized_outline(...)
```

Location:

```text
api/routes.py
```

The payload includes:

- cleaned scholarship record
- student profile
- essay prompt or writing requirements
- word limit
- user notes

The backend returns:

- sections
- suggested content
- profile evidence to use
- prompt or scholarship-focus questions addressed
- section guidance that explains the intended effect on the reader
- coaching notes
- warnings

The essay prompt is used internally for generation but is not displayed in the
personalized outline output.

For a formal essay prompt, the outline keeps each distinct prompt ask in its
original order and assigns it to its own section. Section titles are short
descriptive phrases; the purple requirement labels are concise questions.

---

## 9. Essay Workspace Evaluation

The Essay Workspace uses one primary evaluation path while the student is
drafting.

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
frontend-react/src/lib/suggestions.ts
```

Primary frontend function:

```ts
runWorkspaceCoachingSession(buildCoachingSessionPayload(user, essayPrompt))
```

Primary backend endpoint:

```text
POST /api/apply/coaching-session
```

Backend route function:

```python
run_workspace_coaching_session(...)
```

Backend service:

```text
unified_coaching_service.py
```

Main service function:

```python
run_unified_coaching_session(...)
```

The full review returns the schema-v3 Essay Review only: one weighted overall
score, seven criterion packages, Manager plan, QA/Guardrail audit, mechanics
metadata, optional outline coverage, agent statuses, and warnings.

---

## 10. Background Editor Check

Background editor support is intentionally narrow. Paste/upload auto-checks call:

```text
POST /api/apply/editor-check
```

This endpoint returns grammar sentence suggestions and optional outline coverage.
It does not run the full seven-criterion evaluation.

Sentence suggestions are returned as text anchors, not raw character offsets.

Backend returns each suggestion with:

```text
original_text
suggested_text
suggestion_type
reason
severity
```

Frontend anchoring happens in:

```text
frontend-react/src/lib/suggestions.ts
```

Important functions:

```ts
anchorCoachSuggestions(...)
mergeSuggestions(...)
```

The frontend anchors each suggestion into the current draft, merges coach
suggestions with instant local suggestions, and lets the student reveal, accept,
ignore, or copy suggestions.

---

## 11. Rewrite Selection

The essay editor can ask the backend to rewrite, shorten, expand, or improve
the tone of selected text.

Frontend function:

```ts
runSelectionRewrite(buildRewritePayload(...))
```

Backend endpoint:

```text
POST /api/apply/rewrite-selection
```

Backend route function:

```python
rewrite_selection(...)
```

Actual service function:

```python
run_selection_rewrite(...)
```

Location:

```text
essay_editor_service.py
```

This rewrite path only works on selected text. It has guardrails to avoid large,
fabricated expansions.

---

## 12. Unified Coaching Session and Targeted Tools

The Essay Workspace's primary **Evaluate** button runs one merged
agent graph through:

```text
POST /api/apply/coaching-session
```

The endpoint keeps the deterministic spelling/mechanics pre-correction, then
runs one Manager-first review. The Manager sees the scholarship and essay
prompt—but not the student's draft—and creates a tailored rubric plus seven
criterion weights totaling 100. The rubric and weights are then supplied to
these parallel criterion-review lanes:

The Manager plan carries a scholarship/prompt fingerprint. Revised drafts reuse
the locked plan; changing the scholarship, prompt, writing brief, or word limit
regenerates it.

- **Content:** Alignment (Prompt + Scholarship Values) Coach, Evidence Strength
  Coach, and Insight (Depth + Meaning + Reflection) Coach.
- **Structure:** Narrative Structure, Flow & Coherence Coach.
- **Voice:** Tone & Authenticity Coach and Clarity & Concision Coach.
- **Grammar:** Grammar Coach.
- **Conditional:** Outline Coverage Coach.

Eligibility is intentionally handled
by the earlier Fit Assessment page and is not recalculated by Essay Workspace.
Alignment replaces the former Prompt
Alignment and Opportunity Strategy calls; it checks every prompt part and the
essay's evidence-backed connection to the scholarship's stated values and
priorities. Evidence Strength is one model call that replaces the
former Profile Grounding, Specificity, and Experience Discovery calls; it checks
claim support, usable profile experiences, concrete detail, and measurable
impact together. Narrative Structure, Flow & Coherence is one model call that
replaces the former Structure & Flow and Narrative calls; it checks paragraph
organization, transitions, context-to-takeaway progression, logical continuity,
timeline consistency, contradictions, and missing reasoning. The Insight (Depth
+ Meaning + Reflection) Coach is a separate model call that owns reflection depth, lessons,
realizations, changes in mindset or behavior, personal/community significance,
and future direction. Narrative Structure only judges whether reflection is
present, positioned effectively, and logically connected.

Each of the seven criterion agents is one Scholarship Coach that speaks from an
experienced scholarship reviewer's perspective. Inside one model call, it first
gives restrained, evidence-grounded praise followed by exactly one main gap,
then assigns the tailored-rubric score and gives exactly one specific revision
action that directly fixes that gap. Evidence is woven into the praise and gap,
not returned as a separate list. There is no separate Specialist Assessment,
Evaluator, or Reviewer Simulation agent in the Page 4 session. The seven lanes
run in parallel; conditional Outline Coverage may run beside them but is not scored.

After the criterion wave, QA Critic and Guardrail Critic run in parallel. QA
checks the evidence → coach feedback → score → action chain.
Guardrail checks all seven actions for invented facts, voice replacement, unsafe
assumptions, and vague instructions. Only failed criteria receive one bounded
repair attempt. Python validates the result and calculates the sole overall
score as the Manager-weighted average; an LLM never estimates that aggregate.

The Page 4 endpoint has one canonical schema-v3 review contract. It returns the
overall score, seven criterion packages, Manager plan, and quality audit, plus
mechanics metadata, optional outline coverage, agent statuses, and warnings.
It does not return the former `evaluation`, `coach_pack`, or `components`
compatibility envelopes.

Page 4 displays the overall score and all seven criterion packages together in
one **Essay Review** tab. The former separate Evaluation tab is removed. Each
criterion card shows its score, weight, unified Scholarship Coach feedback, and
one aligned how-to-fix action. Outline and editor Fixes remain
separate tools because they are not duplicate evaluation outputs.

Primary implementation:

```text
unified_coaching_service.py
nodes/coaching/criterion_review.py
```

The only supporting Page 4 endpoints are:

```text
POST /api/apply/editor-check
POST /api/apply/rewrite-selection
```

`editor-check` is background-only grammar and outline coverage. It does not
evaluate the essay. `rewrite-selection` only transforms selected text.

The retired analyze and essay-coach routes are removed.

---

## 14. Local Setup

Install Python dependencies:

```bash
pip install -r requirements.txt
```

Use SQLite locally:

```text
DATABASE_URL=sqlite:///scholar_e.db
```

Run migrations:

```bash
python -c "from alembic.config import main; main(argv=['upgrade','head'])"
```

Start backend directly:

```bash
python server.py
```

Start frontend:

```bash
cd frontend-react
npm install
npm run dev
```

In development, Vite can lazy-start the backend when API routes are called.

---

## 15. Main Files by Folder

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
frontend-react/src/lib/suggestions.ts
frontend-react/vite.config.ts
```

Backend API:

```text
server.py
api/routes.py
```

Essay workspace evaluation:

```text
unified_coaching_service.py
essay_editor_service.py
essay_context.py
templates/essay_coach.py
```

Graphs:

```text
graph/profile_builder.py
graph/opportunity_builder.py
graph/fit_builder.py
graph/builder.py
```

Nodes:

```text
nodes/profile_extraction.py
nodes/opportunity_extraction.py
nodes/coaching/agents.py
nodes/combine.py
nodes/critic.py
nodes/assemble_package.py
```

Persistence:

```text
persistence/database.py
persistence/services.py
persistence/models.py
persistence/vector_service.py
```

---

## 16. Agents and Their Functions

Scholar-E uses several agent groups. Some are registered in the persistence
registry, some are LangGraph nodes, and some are specialist functions inside the
Essay Workspace Evaluation.

### Registered Agents

Registered agent definitions live in:

```text
persistence/agent_registry.py
```

| Agent name | Type | Function |
| --- | --- | --- |
| `resume_profile_extraction` | profile | Extracts editable student profile fields from uploaded resume text. |
| `scholarship_discovery_wiki` | discovery | Recommends scholarship platforms, source pages, and opportunities from the saved profile. |
| `scholarship_requirements_extraction` | extraction | Extracts scholarship facts and requirements from names, links, notes, and fetched source text. |
| `scholarship_information_cleaner` | cleaning | Normalizes extracted scholarship information for editable UI display. |
| `scholarship_fit_analysis` | analysis | Compares the student profile against the cleaned scholarship record. |
| `essay_application_coaching` | coaching | Runs the deep application coaching graph. |

### Profile Agents

Files:

```text
graph/profile_builder.py
nodes/profile_extraction.py
```

| Agent/node | Function |
| --- | --- |
| `profile_extraction_agent` | Uses resume text to extract structured profile fields. |
| `profile_cleanup` | Cleans and normalizes extracted profile fields for the UI. |

Used by:

```text
POST /api/profile/autofill-resume
```

### Scholarship Extraction Agents

Files:

```text
graph/opportunity_builder.py
nodes/opportunity_extraction.py
```

| Agent/node | Function |
| --- | --- |
| `opportunity_extraction_agent` | Extracts scholarship name, organization, website, award, dates, eligibility, materials, criteria, and process. |
| `opportunity_cleanup` | Normalizes the first extraction into consistent fields. |
| `information_cleaner_agent` | Cleans the scholarship record for editable UI display and removes noisy or unsupported artifacts. |

Used by:

```text
POST /api/opportunity/extract
```

### Scholarship Discovery Wiki Agents

File:

```text
graph/wiki_builder.py
```

| Agent/node | Function |
| --- | --- |
| `platform_source_agent` | Recommends scholarship search platforms and source categories. |
| `specific_open_source_agent` | Recommends specific opportunities or source pages. |
| `wiki_output_cleaner_agent` | Cleans and organizes discovery output for the UI. |

Used by:

```text
POST /api/wiki/discover
```

### Scholarship Fit Agents

File:

```text
graph/fit_builder.py
```

| Agent/node | Function |
| --- | --- |
| `fit_analysis_agent` | Compares profile facts against scholarship requirements and estimates fit. |
| `fit_result_cleanup` | Cleans the fit result and prepares the application readiness matrix. |

Used by:

```text
POST /api/fit/analyze
```

### Personalized Outline Agent

File:

```text
api/routes.py
```

Function:

```python
generate_personalized_outline(...)
```

This is not a LangGraph node, but it is an LLM agent-style flow. It creates:

- essay sections
- suggested content
- profile evidence to use
- prompt or scholarship-focus questions addressed
- section guidance that combines a writing action with its intended effect on the reader
- coaching notes

Used by:

```text
POST /api/apply/generate-outline
```

### Essay Workspace Evaluation Agents

File:

```text
unified_coaching_service.py
nodes/coaching/criterion_review.py
```

Main coordinator:

```python
run_unified_coaching_session(...)
```

| Stage | Agent | Function |
| --- | --- | --- |
| Serial setup | Manager Agent | Assigns seven scholarship/prompt-specific weights totaling 100 and creates the locked tailored rubric without seeing the draft. |
| Content | Alignment (Prompt + Scholarship Values) Coach | Combines full prompt coverage with evidence-backed fit to the scholarship's stated values, selection priorities, and opportunity-specific goals. |
| Content | Evidence Strength Coach | Combines profile grounding, experience discovery, specificity, and impact; flags unsupported or unverifiable details and surfaces stronger real profile evidence. |
| Content | Insight (Depth + Meaning + Reflection) Coach | Evaluates reflection depth, lessons and realizations, personal change, significance to self or others, and grounded connections to future direction. |
| Structure | Narrative Structure, Flow & Coherence Coach | Combines paragraph organization, transitions, narrative arc, logical continuity, timeline consistency, contradictions, and missing reasoning. |
| Voice | Tone & Authenticity Coach | Protects the student's voice; evaluates sincerity, thoughtfulness, confidence, respect, and genuinely student-written language; flags generic, overly polished, corporate, formulaic, performative, and AI-like phrasing. |
| Voice | Clarity & Concision Coach | Evaluates whether sentences are understandable, direct, and free of filler, repetition, wordiness, unclear phrasing, and tangled construction. |
| Grammar | Grammar Coach | Evaluates spelling, punctuation, capitalization, verb tense, agreement, grammar, and sentence-level correctness. |
| Every criterion lane | Scholarship Coach role | Combines criterion expertise with the scholarship reviewer's perspective, giving grounded praise, one main gap, a score, and one directly aligned action. |
| Conditional | Outline Coverage Coach | Checks which personalized outline points are covered by the draft. |
| Parallel quality control | QA Critic | Audits evidence grounding, unified coach feedback, rubric score, and action consistency across all seven criteria. |
| Parallel quality control | Guardrail Critic | Rejects criterion actions that invent facts, replace the student's voice, make unsafe assumptions, or lack specific instructions. |
| Deterministic finalizer | Backend code | Validates all fields and calculates one weighted overall score from the Manager's weights. |

Used by:

```text
POST /api/apply/coaching-session
```

### Targeted Editor Tools

File:

```text
essay_editor_service.py
```

| Tool | Function |
| --- | --- |
| Background editor check | Returns grammar sentence suggestions and optional outline coverage. |
| Selection Rewrite Agent | Rewrites, shortens, expands, or improves tone for selected text only. |

Used by:

```text
POST /api/apply/editor-check
POST /api/apply/rewrite-selection
```

### Retained Essay-Section Templates

These template definitions are retained for possible future reuse but are not
wired into either coaching graph or any API response:

```text
templates/base.py
templates/personal_statement.py
templates/leadership_impact.py
templates/experience_achievements.py
```

### Python-Only Helper Coach

File:

```text
nodes/coaching/readiness.py
```

| Function | Role |
| --- | --- |
| Growth Coach | Compares readiness across drafts without an LLM. |
| Readiness helpers | Normalize readiness scores and labels. |

### Summary

- Profile agents build the student profile.
- Scholarship agents discover, extract, clean, and analyze opportunities.
- Essay Workspace Evaluation agents score the draft with the Manager-led schema-v3 review.
- Targeted editor tools support grammar checks, outline coverage, and selected-text rewrites.
- Critic and guardrail agents protect against hallucinated or unsupported coaching.
