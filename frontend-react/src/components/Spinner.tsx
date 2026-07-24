/**
 * Minimal, colour-adaptive loading spinner. Uses `currentColor` so it reads
 * correctly inside both filled (white text) and outline (dark text) buttons.
 * Pair with the `.agent-loading` class for the sheen sweep while agents run.
 */
export function Spinner({ className = "size-4" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}
