/**
 * Per-route facet detection from a route-registration snippet — the same
 * text-scan strategy used by {@link ./access-classifier.classifyAccess}. These
 * facets enrich the catalog with the idempotency and deprecation columns.
 */

/** True when the route options declare `config.idempotencyRequired: true`. */
export function detectIdempotencyRequired(snippet: string): boolean {
  return /idempotencyRequired\s*:\s*true/.test(snippet);
}

/**
 * True when the route advertises deprecation — either by emitting RFC 8594 /
 * RFC 9745 headers via `applyDeprecatedEndpointHeaders` or by a `DEPRECATED`
 * marker in its summary.
 */
export function detectDeprecated(snippet: string): boolean {
  return snippet.includes('applyDeprecatedEndpointHeaders') || /DEPRECATED/.test(snippet);
}
