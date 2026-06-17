/** Routes excluded from validate-route-http-coverage (tested elsewhere or special setup). */
export const ROUTE_HTTP_COVERAGE_ALLOWLIST: Array<{ method: string; path: string }> = [
  { method: 'GET', path: '/livez' },
  { method: 'GET', path: '/readyz' },
  { method: 'POST', path: '/api/v1/mcp' },
  // Bare (non-versioned) MCP catalog duplicate of /api/v1/mcp. Same JSON-RPC proxy route;
  // its auth/role gate (401 no-token, 403 non-admin) is covered by
  // src/tests/security/auth/mcp-auth.security.test.ts. The mutating-method heuristic only
  // inspects the first `/mcp` occurrence, so allowlist the bare form explicitly.
  { method: 'GET', path: '/mcp' },
  { method: 'POST', path: '/mcp' },
  { method: 'GET', path: '/api/v1/auth/oauth/:provider/callback' },
  { method: 'GET', path: '/api/v1/auth/oauth/:provider' },
];
