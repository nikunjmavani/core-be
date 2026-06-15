import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROUTE_EXAMPLES_PATH } from '@tooling/openapi/route-examples/constants.js';

/** Sanitized captured examples for one route: optional request body + per-status response bodies. */
export type CapturedRouteExamples = {
  request_body?: unknown;
  responses: Record<string, unknown>;
};

/**
 * Loads the committed captured-example fixture re-keyed to the OpenAPI
 * `{param}` path style (`"METHOD /api/v1/users/{user_id}"`). Returns an empty
 * map when the fixture has not been generated yet, so docs generation works on
 * fresh clones before the first capture run.
 */
export function loadCapturedRouteExamples(): Record<string, CapturedRouteExamples> {
  const fixturePath = resolve(process.cwd(), ROUTE_EXAMPLES_PATH);
  if (!existsSync(fixturePath)) {
    return {};
  }
  const raw = JSON.parse(readFileSync(fixturePath, 'utf-8')) as Record<
    string,
    CapturedRouteExamples
  >;
  return Object.fromEntries(
    Object.entries(raw).map(([routeKey, examples]) => [
      routeKey.replace(/:([A-Za-z_]+)/g, '{$1}'),
      examples,
    ]),
  );
}
