# Backend Integration

The Essay Workspace uses one canonical evaluation path:

- `POST /api/apply/coaching-session`
  - evaluates the submitted draft without rewriting it
  - runs the Manager-led seven-criterion Essay Review
  - returns `review.schema_version === 3`

Background editor support is intentionally narrow:

- `POST /api/apply/editor-check`
  - returns grammar sentence suggestions
  - returns optional outline coverage ids
  - does not run the full evaluation pipeline

Selected-text tools are separate:

- `POST /api/apply/rewrite-selection`
  - rewrites, expands, shortens, or adjusts tone for selected text only

The frontend stores the latest full evaluation in `user.essayReviewResult`.
Legacy `lastAnalysis` data is ignored and removed during store hydration.
