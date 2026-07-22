# Backend Integration

The Essay Workspace uses one canonical evaluation path:

- `POST /api/apply/coaching-session`
  - evaluates the submitted draft without rewriting it
  - runs the Manager-led six-criterion Essay Review
  - returns `review.schema_version === 4`

Background editor support is intentionally narrow:

- `POST /api/apply/editor-warmup`
  - starts the reusable LanguageTool Java service without blocking API startup
  - is called idempotently when the Journey loads as a cold-start fallback
  - lets the editor quietly retry while warm-up is still in progress

- `POST /api/apply/editor-check`
  - returns LanguageTool spelling, grammar, and punctuation suggestions
  - protects profile terms and the student's personal dictionary
  - requires the student to accept or ignore each fix individually
  - does not run the full evaluation pipeline

- `POST /api/apply/contextual-grammar`
  - runs after a longer typing pause for meaning-dependent grammar
  - merges behind LanguageTool, which wins when findings overlap
  - fails independently so the faster Fixes remain available

- `POST /api/apply/outline-coverage`
  - updates outline checkmarks independently from sentence Fixes

Selected-text tools are separate:

- `POST /api/apply/rewrite-selection`
  - rewrites, expands, shortens, or adjusts tone for selected text only

The frontend stores the latest full evaluation in `user.essayReviewResult`.
Legacy `lastAnalysis` data is ignored and removed during store hydration.
