import { describe, expect, it } from 'vitest';
import type { RouteEntry } from '@/tests/helpers/route-catalog-registry.js';
import {
  evaluateRouteSuccessCoverage,
  ROUTE_SUCCESS_DRIFT_EXEMPT_KEYS,
} from '@/scripts/validators/routes/route-success-coverage.util.js';

function route(method: RouteEntry['method'], path: string): RouteEntry {
  return {
    method,
    path,
    domain: 'test',
    access: 'authenticated',
    description: `${method} ${path}`,
  };
}

/**
 * Pure-logic tests for the observed success-status coverage evaluation used by
 * pnpm validate:route-success-coverage.
 */
describe('evaluateRouteSuccessCoverage', () => {
  const registry = [
    route('GET', '/api/v1/widgets'),
    route('POST', '/api/v1/widgets'),
    route('DELETE', '/api/v1/widgets/:widgetId'),
  ];
  const successStatusMap = {
    'GET /api/v1/widgets': 200,
    'POST /api/v1/widgets': 201,
    'DELETE /api/v1/widgets/:widgetId': 204,
  };

  it('marks a route covered when its declared status was observed', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: ['GET /api/v1/widgets 200', 'GET /api/v1/widgets 401'],
    });
    expect(result.coveredRoutes).toEqual(['GET /api/v1/widgets']);
    expect(result.uncoveredRoutes).toEqual([
      'DELETE /api/v1/widgets/:widgetId',
      'POST /api/v1/widgets',
    ]);
    expect(result.driftFailures).toEqual([]);
  });

  it('keeps a route uncovered when only error statuses were observed', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: ['POST /api/v1/widgets 400', 'POST /api/v1/widgets 401'],
    });
    expect(result.coveredRoutes).toEqual([]);
    expect(result.uncoveredRoutes).toContain('POST /api/v1/widgets');
    expect(result.driftFailures).toEqual([]);
  });

  it('reports drift when an observed success status contradicts the declared one', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: ['POST /api/v1/widgets 200'],
    });
    expect(result.driftFailures).toHaveLength(1);
    expect(result.driftFailures[0]).toContain('declared 201 but observed 200');
    expect(result.coveredRoutes).toEqual([]);
  });

  it('treats redirects (3xx) on catalog routes as drift', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: ['GET /api/v1/widgets 302'],
    });
    expect(result.driftFailures).toHaveLength(1);
  });

  it('treats 304 Not Modified as an alternate success, not drift', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: ['GET /api/v1/widgets 304', 'GET /api/v1/widgets 200'],
    });
    expect(result.driftFailures).toEqual([]);
    expect(result.coveredRoutes).toEqual(['GET /api/v1/widgets']);
  });

  it('does not count a lone 304 as coverage of the declared 200', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: ['GET /api/v1/widgets 304'],
    });
    expect(result.driftFailures).toEqual([]);
    expect(result.uncoveredRoutes).toContain('GET /api/v1/widgets');
  });

  it('skips drift for exempt keys but still requires coverage', () => {
    const exemptRegistry = [route('GET', '/api/v1/mcp')];
    const result = evaluateRouteSuccessCoverage({
      registry: exemptRegistry,
      successStatusMap: { 'GET /api/v1/mcp': 200 },
      observedLines: ['GET /api/v1/mcp 405'],
      driftExemptKeys: ROUTE_SUCCESS_DRIFT_EXEMPT_KEYS,
    });
    expect(result.driftFailures).toEqual([]);
    expect(result.uncoveredRoutes).toEqual(['GET /api/v1/mcp']);
  });

  it('normalizes trailing slashes from Fastify prefix-root registrations', () => {
    const result = evaluateRouteSuccessCoverage({
      registry: [route('GET', '/api/v1/widgets')],
      successStatusMap: { 'GET /api/v1/widgets': 200 },
      observedLines: ['GET /api/v1/widgets/ 200'],
    });
    expect(result.coveredRoutes).toEqual(['GET /api/v1/widgets']);
  });

  it('ignores malformed lines and unknown routes', () => {
    const result = evaluateRouteSuccessCoverage({
      registry,
      successStatusMap,
      observedLines: [
        '',
        'garbage',
        'HEAD /api/v1/widgets 200',
        'GET /api/v1/unknown 200',
        'DELETE /api/v1/widgets/:widgetId 204',
      ],
    });
    expect(result.coveredRoutes).toEqual(['DELETE /api/v1/widgets/:widgetId']);
    expect(result.driftFailures).toEqual([]);
  });
});
