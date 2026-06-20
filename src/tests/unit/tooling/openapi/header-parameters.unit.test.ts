import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHeaderParameters } from '@tooling/openapi/emitters/header-parameters.js';

type HeaderParameter = {
  name: string;
  in: string;
  required: boolean;
  schema?: { type?: string; minLength?: number; maxLength?: number };
};

const ROUTE_CATALOG_PATH = join(process.cwd(), 'docs', 'routes.txt');
const IDEMPOTENCY_BLOCK_PATTERN = /IDEMPOTENCY-REQUIRED WRITES \((\d+)\)/;
const CATALOG_ROUTE_PATTERN = /^\s+(GET|POST|PUT|PATCH|DELETE)\s+(\/\S+)\s*$/;

/**
 * Parses the dedicated "IDEMPOTENCY-REQUIRED WRITES (N)" block from docs/routes.txt
 * (the single source of truth for the `I` column) into OpenAPI-style route keys —
 * `:param` rewritten to `{param}` — alongside the count the catalog declares.
 */
function loadIdempotencyRequiredRoutes(): { declaredCount: number; routeKeys: string[] } {
  const lines = readFileSync(ROUTE_CATALOG_PATH, 'utf-8').split('\n');
  const headerIndex = lines.findIndex((line) => IDEMPOTENCY_BLOCK_PATTERN.test(line));
  if (headerIndex === -1) {
    throw new Error('IDEMPOTENCY-REQUIRED WRITES block not found in docs/routes.txt');
  }

  const declaredCount = Number(IDEMPOTENCY_BLOCK_PATTERN.exec(lines[headerIndex] ?? '')?.[1]);

  const routeKeys: string[] = [];
  for (const line of lines.slice(headerIndex + 1)) {
    const match = CATALOG_ROUTE_PATTERN.exec(line);
    if (match) {
      const path = (match[2] ?? '').replace(/:([A-Za-z0-9_]+)/g, '{$1}');
      routeKeys.push(`${match[1]} ${path}`);
      continue;
    }
    if (routeKeys.length > 0 && (line.includes('===') || line.includes('See docs'))) break;
  }

  return { declaredCount, routeKeys };
}

function idempotencyHeaderFor(routeKey: string): HeaderParameter | undefined {
  // The emitter keys on the full "METHOD /path" string, so pass it verbatim (not just the path).
  const method = routeKey.split(' ')[0] ?? 'POST';
  return (buildHeaderParameters(method, routeKey) as HeaderParameter[]).find(
    (header) => header.name === 'X-Idempotency-Key',
  );
}

describe('OpenAPI X-Idempotency-Key header parameter', () => {
  const { declaredCount, routeKeys } = loadIdempotencyRequiredRoutes();

  it('marks the header required on every idempotency-required write in docs/routes.txt', () => {
    // The emitter must not drift from the route catalog: each `idempotencyRequired: true` write
    // 422s without the header, so its OpenAPI parameter has to advertise `required: true`.
    expect(routeKeys).toHaveLength(declaredCount);
    expect(routeKeys.length).toBeGreaterThan(0);

    const notMarkedRequired = routeKeys.filter((routeKey) => {
      const header = idempotencyHeaderFor(routeKey);
      return header?.required !== true;
    });

    expect(notMarkedRequired).toEqual([]);
  });

  it('advertises a 16–255 character schema matching the parser contract', () => {
    const [firstKey = 'POST /api/v1/billing/subscriptions'] = routeKeys;
    const header = idempotencyHeaderFor(firstKey);
    expect(header?.schema).toMatchObject({ type: 'string', minLength: 16, maxLength: 255 });
  });

  it('keeps the header optional on a mutating write that is not idempotency-required', () => {
    const header = idempotencyHeaderFor('PATCH /api/v1/billing/subscriptions/{subscription_id}');
    expect(header).toBeDefined();
    expect(header?.required).toBe(false);
  });
});
