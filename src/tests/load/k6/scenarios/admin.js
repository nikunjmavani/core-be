import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS } from '../helpers/config.js';
import { checkOk, checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

/**
 * k6 Scenario: Admin Operations
 *
 * Simulates admin user operations:
 * - List users (admin)
 * - List audit logs (admin)
 * - List permissions
 */
export const options = {
  scenarios: {
    // Sustained 10 VUs rather than 1, so the shared `http_reqs: rate>10` floor is met by the
    // scenario's own throughput instead of being waived. A single VU with 2s of think-time per
    // iteration tops out near 1.5 req/s — under the floor by construction, which is why an
    // earlier revision reached for SMOKE_THRESHOLDS. Ten VUs at the same think-time sustain
    // ~14.6 req/s, clearing the floor with margin rather than by rounding.
    //
    // constant-vus, not the ramping `load` preset: a ramp spends half its wall-clock below
    // target, which dilutes the run-wide rate to ~11 req/s — technically over, but too close to
    // the floor to be a stable gate.
    load: { executor: 'constant-vus', vus: 10, duration: '30s', exec: 'adminOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:list-users}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:list-audit-logs}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:list-permissions}': ['p(95)<200', 'p(99)<400'],
  },
};

export function adminOps() {
  const token = __ENV.ADMIN_TOKEN;
  if (!token) {
    console.error('ADMIN_TOKEN env var required');
    return;
  }

  const headers = authHeaders(token).headers;

  // List users
  const usersResponse = http.get(`${API_PREFIX}/users/`, {
    headers,
    tags: { name: 'list-users' },
  });
  checkOk(usersResponse, 'list-users');
  checkResponseTime(usersResponse, 500, 'list-users');

  sleep(0.5);

  // Audit logs
  const auditResponse = http.get(`${API_PREFIX}/audit/logs`, {
    headers,
    tags: { name: 'list-audit-logs' },
  });
  checkOk(auditResponse, 'list-audit-logs');
  checkResponseTime(auditResponse, 500, 'list-audit-logs');

  sleep(0.5);

  // Permissions — authenticated (routes.txt: AUTH), not public. Without the header
  // every request 401s and the check fails on 100% of iterations.
  const permResponse = http.get(`${API_PREFIX}/tenancy/permissions`, {
    headers,
    tags: { name: 'list-permissions' },
  });
  checkOk(permResponse, 'list-permissions');
  checkResponseTime(permResponse, 200, 'list-permissions');

  sleep(1);
}

export default adminOps;
