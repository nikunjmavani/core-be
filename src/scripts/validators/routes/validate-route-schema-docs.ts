/**
 * Route schema-doc gate.
 *
 * Every Fastify route registration in a `*.routes.ts` file (plus the two special
 * non-routes files that register routes — the health middleware and the
 * MCP server) MUST carry a `schema` block with `summary`, `description`, and
 * `tags`. That block is the single source of truth for OpenAPI generation, so a
 * missing field ships an undocumented operation. This gate fails closed.
 *
 * Owned by the route-schema-doc-guard skill. Usage: `pnpm validate:route-schema-docs`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const DOMAINS_ROOT = join(PROJECT_ROOT, 'src', 'domains');

/** Non-`*.routes.ts` files that nonetheless register HTTP routes (per the skill). */
const EXTRA_ROUTE_FILES = [
  join(PROJECT_ROOT, 'src', 'shared', 'middlewares', 'core', 'health.middleware.ts'),
  join(PROJECT_ROOT, 'src', 'infrastructure', 'mcp', 'mcp-server.ts'),
];

const REQUIRED_SCHEMA_FIELDS = ['summary:', 'description:', 'tags:'] as const;
const ROUTE_REGISTRATION_PATTERN =
  /\.(get|post|put|patch|delete)\s*(?:<[^>]*>)?\s*\(\s*(['"`])([^'"`]+)\2/g;

function collectRouteFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      collectRouteFiles(fullPath, collected);
    } else if (entry.endsWith('.routes.ts')) {
      collected.push(fullPath);
    }
  }
  return collected;
}

/** Returns the `{ … }` options block immediately following a route registration. */
function extractOptionsBlock(source: string, fromIndex: number): string {
  const optionsStart = source.indexOf('{', fromIndex);
  if (optionsStart === -1) return '';
  let depth = 0;
  for (let index = optionsStart; index < source.length; index++) {
    const character = source[index];
    if (character === '{') depth++;
    else if (character === '}' && --depth === 0) return source.slice(optionsStart, index + 1);
  }
  return source.slice(optionsStart);
}

function findSchemaDocGaps(source: string, relativePath: string): string[] {
  const gaps: string[] = [];
  for (const match of source.matchAll(ROUTE_REGISTRATION_PATTERN)) {
    const method = match[1]?.toUpperCase();
    const routePath = match[3];
    if (!(method && routePath)) continue;

    // Start the options-block scan AFTER the matched `.method<generics>('path'` so a
    // `<{ Params: { … } }>` generic block is not mistaken for the options object.
    const optionsBlock = extractOptionsBlock(source, (match.index ?? 0) + match[0].length);
    const missing = REQUIRED_SCHEMA_FIELDS.filter((field) => !optionsBlock.includes(field)).map(
      (field) => field.replace(':', ''),
    );
    if (missing.length > 0) {
      gaps.push(`${relativePath}: ${method} ${routePath} (missing ${missing.join(', ')})`);
    }
  }
  return gaps;
}

function main(): void {
  const files = [...collectRouteFiles(DOMAINS_ROOT), ...EXTRA_ROUTE_FILES];
  const gaps: string[] = [];

  for (const absolutePath of files) {
    const source = readFileSync(absolutePath, 'utf-8');
    const relativePath = absolutePath.replace(`${PROJECT_ROOT}/`, '');
    gaps.push(...findSchemaDocGaps(source, relativePath));
  }

  if (gaps.length > 0) {
    console.error(
      'validate-route-schema-docs failed — route(s) missing schema summary/description/tags:\n',
    );
    for (const gap of gaps) console.error(`  - ${gap}`);
    console.error('\nEvery route registration needs schema: { summary, description, tags }.');
    process.exit(1);
  }

  console.log(`✅ validate-route-schema-docs passed (${files.length} files scanned)`);
}

main();
