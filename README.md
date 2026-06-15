# ScholarlE Engen — Backend (Prototype)

## Overview

ScholarlE Engen is an AI-powered coaching platform for **scholarships, college
applications, and internships**. This backend is a modular AI pipeline built
with:

* Retrieval-Augmented Generation (RAG)
* A node-based workflow (LangGraph)
* A shared state object for orchestration

The goal is to **coach students** on their own application drafts — analyzing the
opportunity, grounding feedback in the student's real profile, scoring the
draft, and assembling a coaching package. It coaches; it does **not** ghostwrite,
and it never invents student facts.

---

## Workflow

```text
analyze_opportunity
    ↓
retrieve_profile
    ↓
score_application
    ↓
assemble_package
    ↓
END
```

| Node | Responsibility |
| --- | --- |
| `analyze_opportunity` | Extract opportunity type, requirements, deadlines, and evaluation themes as JSON |
| `retrieve_profile` | Retrieve relevant student profile chunks from the vector store (only uploaded info) |
| `score_application` | Score the student draft and give grounded coaching feedback |
| `assemble_package` | Build a markdown coaching package and save it to `outputs/` |

---

## Project Structure

```text
.
├── app.py                  # Entry point / pipeline runner
├── config.py               # Settings + .env loading
├── graph/
│   └── builder.py          # LangGraph wiring
├── state/
│   └── application_state.py # ApplicationState (shared state)
├── nodes/
│   ├── analyze_opportunity.py
│   ├── retrieve_profile.py
│   ├── score_application.py
│   └── assemble_package.py
├── rag/
│   ├── ingest.py           # Load + chunk .txt documents
│   ├── store.py            # Chroma vector store
│   └── retrieve.py         # Similarity retrieval
├── llm/
│   └── client.py           # LLM client
├── utils/
│   └── parsing.py          # safe JSON parsing
├── outputs/
│   └── writer.py           # Save markdown output
├── api/
│   └── routes.py           # API entry-point placeholder
└── documents/
    ├── opportunities/      # Opportunity prompt(s) (.txt)
    ├── student_profile/    # Student profile documents (.txt)
    └── student_draft.txt   # The draft to coach / score
```

---

## Setup

1. Create / activate your environment, then install dependencies:

```bash
pip install -r requirements.txt
```

2. Add a `.env` file at the project root with your OpenAI key:

```text
OPENAI_API_KEY=sk-...
```

(`.env` is git-ignored.)

---

## Usage

1. Put the opportunity prompt(s) in `documents/opportunities/` (`.txt`).
2. Put the student's profile documents in `documents/student_profile/` (`.txt`).
3. Put the student's draft in `documents/student_draft.txt`.
4. Run:

```bash
python app.py
```

The final coaching package is written to:

```text
outputs/final_application_package.md
```

---

## Grounding Rules

The system only uses information from:

1. The opportunity prompt
2. The student profile documents
3. The student draft

It never invents awards, grades, schools, internships, leadership roles,
personal stories, or metrics. When information is missing, it responds:

> Missing from student profile. Ask the student for this information before
> using it.

---

## Notes

* Only `.txt` document ingestion is supported in this prototype.
* Profile vector stores are persisted by profile content and reused when the
  same uploaded profile is analyzed again.
* `api/routes.py` is a placeholder that exposes the pipeline as a single
  callable, ready to be wired to FastAPI / Flask later.
