import type { RouteSchemaEntry } from '@tooling/openapi/extractors/route-schema-metadata.js';

/**
 * Returns one `"<METHOD> <path> (missing: …)"` line per route that is missing
 * `summary`, `description`, or `tags`. An empty array means every route is fully
 * documented. Pure (no I/O) so it is unit-testable with fixture entries.
 */
export function findRouteSchemaDocProblems(entries: readonly RouteSchemaEntry[]): string[] {
  return entries
    .map((entry) => {
      const missing: string[] = [];
      if (!entry.metadata.summary) missing.push('summary');
      if (!entry.metadata.description) missing.push('description');
      if (!entry.metadata.tags) missing.push('tags');
      return missing.length > 0 ? `${entry.lookupKey} (missing: ${missing.join(', ')})` : null;
    })
    .filter((line): line is string => line !== null)
    .sort();
}
