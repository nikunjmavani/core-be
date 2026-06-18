/**
 * Route params-schema gate.
 *
 * Every Fastify route registration whose path carries a `:param` segment must declare a
 * `schema.params` Zod schema, so malformed/oversized path parameters are rejected at the
 * Fastify boundary (clean 400) and the parameter is reflected in the generated OpenAPI
 * contract. Controllers still run the authoritative entity-prefix check via
 * `validatePublicIdParam`; this gate prevents the structural-debt regression (audit insight
 * "Route Schema Debt") of adding a `:param` route without the matching boundary schema.
 *
 * The DTO may be a permissive length bound (e.g. `trimmedStringMinMax(1, 28)`) — the point is
 * that *some* `params` schema exists at the boundary, not that it re-implements the strict
 * entity-prefix format (which the controller owns).
 *
 * Usage: `pnpm validate:route-params-schema`
 */
import { collectAllRouteSchemaEntries } from '@tooling/openapi/extractors/route-schema-metadata.js';

/** Matches a Fastify `:param` segment in a route path (e.g. `/organization/roles/:role_id`). */
const PATH_PARAM_PATTERN = /\/:[A-Za-z_][A-Za-z0-9_]*/;

function main(): void {
  const entries = collectAllRouteSchemaEntries();
  const parameterizedEntries = entries.filter((entry) => PATH_PARAM_PATTERN.test(entry.fullPath));
  const problems = parameterizedEntries
    .filter((entry) => !entry.hasParamsSchema)
    .map((entry) => `${entry.method} ${entry.fullPath}`);

  if (problems.length > 0) {
    console.error('validate-route-params-schema failed:\n');
    console.error('Routes with a `:param` path segment but no `schema.params` Zod schema:');
    for (const line of problems) console.error(`  - ${line}`);
    console.error(
      '\nAttach a `params: <dto>` schema to each route (see agent-os/skills/api-contract-guard/SKILL.md). ' +
        'The DTO can be a permissive length bound; the controller still runs validatePublicIdParam.',
    );
    process.exit(1);
  }

  console.log(
    `✅ validate-route-params-schema passed (${parameterizedEntries.length} parameterized routes carry params schemas)`,
  );
}

main();
