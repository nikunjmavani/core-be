/** Routes excluded from validate-route-http-coverage (tested elsewhere or special setup). */
export const ROUTE_HTTP_COVERAGE_ALLOWLIST: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/livez' },
  { method: 'GET', path: '/readyz' },
  { method: 'POST', path: '/api/v1/mcp' },
  { method: 'POST', path: '/api/v1/billing/stripe/webhook' },
  { method: 'GET', path: '/api/v1/auth/oauth/:provider/callback' },
  { method: 'GET', path: '/api/v1/auth/oauth/:provider' },
];
