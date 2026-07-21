# Scholar-E Backend Integration

This React/Lovable UI is a frontend shell only. AI analysis, LangGraph orchestration, retrieval, embeddings, and Chroma vector-store reuse stay in the Python/FastAPI backend.

## Local Development

Run the Python backend from the project root:

```bash
.venv/bin/python server.py
```

Run the React frontend from this folder:

```bash
cd frontend-react
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `http://127.0.0.1:8000`, so the frontend can call:

```text
POST /api/analyze
```

without moving backend logic into React.

## Wired Backend Flow

The journey route now:

- stores the active scholarship in `user.activeScholarship`
- converts the student profile into backend-ready text
- sends profile, essay, scholarship name/type, and prompt to `/api/analyze`
- stores the FastAPI response in `user.lastAnalysis`
- renders backend readiness scores, reviewer comments, and revision priorities

The integration helper is:

```text
src/lib/api/scholarE.ts
```

The shared frontend state additions are in:

```text
src/lib/userStore.tsx
```
