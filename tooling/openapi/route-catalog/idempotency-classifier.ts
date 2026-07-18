/**
 * Snippet-based classifier for route catalog flags — mirrors
 * {@link ./access-classifier.ts} but for idempotency, which is read off a route
 * registration's source snippet rather than its access guards.
 */

/** True when the route opts into required idempotency (`config: { idempotencyRequired: true }`). */
export function classifyIdempotency(snippet: string): boolean {
  return /idempotencyRequired\s*:\s*true/.test(snippet);
}
