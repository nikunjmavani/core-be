/**
 * Helpers for route registry ↔ Fastify parity tests.
 */

export type RegisteredRouteCapture = {
  method: string;
  url: string;
};

/** Routes registered in code but intentionally omitted from the generated catalog. */
/** Bull Board dashboard (ENABLE_QUEUE_DASHBOARD); not part of public API catalog. */
export const ROUTE_REGISTRY_ALLOWLIST = new Set<string>([
  'GET /admin/queues',
  'HEAD /admin/queues',
  'POST /api/v1/billing/stripe/webhook',
  'GET /health',
]);

export function normalizeRegisteredRouteKey(method: string, url: string): string {
  let normalizedPath = url;
  if (normalizedPath.length > 1 && normalizedPath.endsWith('/')) {
    normalizedPath = normalizedPath.slice(0, -1);
  }
  return `${method.toUpperCase()} ${normalizedPath}`;
}

export function isAllowlistedRegisteredRoute(method: string, url: string): boolean {
  const key = normalizeRegisteredRouteKey(method, url);
  if (ROUTE_REGISTRY_ALLOWLIST.has(key)) {
    return true;
  }

  if (key.startsWith('GET /admin/queues') || key.startsWith('HEAD /admin/queues')) {
    return true;
  }

  return false;
}

export function isApiRoutePath(url: string): boolean {
  return url.startsWith('/api/v1/') || url.startsWith('/health/');
}
