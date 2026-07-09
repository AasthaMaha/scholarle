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
POST /api/apply/essay-coach
POST /api/apply/rewrite-selection
POST /api/analyze
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

## 5. Scholarship Extraction

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

## 6. Scholarship Fit Analysis

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

## 7. Personalized Outline

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

- outline title
- core message
- sections
- suggested content
- profile evidence to use
- scholarship requirements addressed
- coaching notes
- opening and conclusion guidance
- questions for the student
- warnings

The essay prompt is used internally for generation but is not displayed in the
personalized outline output.

---

## 8. Essay Workspace Coach

The Essay Workspace Coach is the interactive writing coach used while the
student is drafting.

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
frontend-react/src/lib/suggestions.ts
```

Frontend function:

```ts
runEssayCoach(buildEssayCoachPayload(user, mode))
```

Backend endpoint:

```text
POST /api/apply/essay-coach
```

Backend route function:

```python
run_essay_coach(...)
```

Backend service:

```text
essay_coaching_service.py
```

Main service function:

```python
run_essay_workspace_coach(...)
```

This coach supports modes:

```text
full
grammar_tone
prompt_alignment
structure
reviewer
final_check
auto_check
```

It can run these specialists:

- Sentence Corrector
- Prompt Alignment Coach
- Profile Grounding Coach
- Structure & Flow Coach
- Specificity Coach
- Tone & Authenticity Coach
- Reviewer Simulation
- Outline Coverage
- Guardrail Critic
- Final Check
- Combiner

The UI displays:

- sentence-level suggestions
- coach summary
- warnings
- top revision priorities
- quick fixes
- deeper revision tasks
- scores
- prompt alignment
- profile grounding
- structure and flow feedback
- specificity and impact feedback
- tone and authenticity feedback
- reviewer simulation
- final check status

This system is designed for live writing and revision inside the essay
workspace.

---

## 9. Sentence Suggestions

Sentence suggestions are returned by the Essay Workspace Coach as text anchors,
not raw character offsets.

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

## 10. Rewrite Selection

The essay editor can ask the backend to rewrite, shorten, expand, or improve
the tone of selected text.

Frontend function:

```ts
rewriteSelection(...)
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
essay_coaching_service.py
```

This rewrite path only works on selected text. It has guardrails to avoid large,
fabricated expansions.

---

## 11. Deep Application Coach

The Deep Application Coach is the larger application-evaluation graph.

It is separate from the Essay Workspace Coach.

Frontend trigger:

```text
frontend-react/src/components/CoachRunButton.tsx
```

Frontend function:

```ts
analyzeApplication(...)
```

Backend endpoint:

```text
POST /api/analyze
```

Backend function:

```python
analyze_application(...)
```

Location:

```text
api/routes.py
```

The backend invokes:

```text
graph/builder.py
```

That graph runs:

- analyzer
- retriever
- strategy coach
- eligibility matrix coach
- discovery coach
- narrative coach
- section coach
- reviewer simulation
- combiner
- critic
- essay alignment matrix
- final package assembler

Important files:

```text
nodes/coaching/agents.py
nodes/coach_sections.py
nodes/combine.py
nodes/critic.py
nodes/assemble_package.py
```

The response includes:

- readiness index
- coaching brief
- growth report
- reviewer comments
- coaching reports
- eligibility matrix
- essay alignment matrix
- section-by-section coaching
- final application package
- revision priorities

This system is designed for full application evaluation, not live editing.

---

## 12. Two Coaching Systems

Scholar-E currently has two coaching systems.

### Essay Workspace Coach

```text
POST /api/apply/essay-coach
essay_coaching_service.py
```

Purpose:

```text
How do I improve this draft right now?
```

Used for:

- sentence fixes
- prompt alignment
- grounding checks
- structure feedback
- tone feedback
- reviewer-style feedback
- final check
- live editing support

### Deep Application Coach

```text
POST /api/analyze
graph/builder.py
```

Purpose:

```text
How strong is my full application for this scholarship?
```

Used for:

- readiness scoring
- full coaching brief
- eligibility matrix
- essay alignment matrix
- reviewer simulation
- final application package

In short:

```text
Essay Workspace Coach = live writing coach inside the editor
Deep Application Coach = full application review board
```

---

## 13. Local Setup

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

## 14. Main Files by Folder

Frontend:

```text
frontend-react/src/routes/journey.tsx
frontend-react/src/lib/api/scholarE.ts
frontend-react/src/lib/suggestions.ts
frontend-react/src/components/CoachRunButton.tsx
frontend-react/vite.config.ts
```

Backend API:

```text
server.py
api/routes.py
```

Essay workspace coach:

```text
essay_coaching_service.py
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
nodes/coach_sections.py
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
