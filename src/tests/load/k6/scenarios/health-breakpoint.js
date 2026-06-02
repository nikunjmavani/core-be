import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, SCENARIOS, BREAKPOINT_THRESHOLDS } from '../helpers/config.js';

/**
 * k6 Scenario: capacity / breakpoint test against the readiness endpoint.
 *
 * Ramps the request *arrival rate* (10 → 300 req/s) until the system breaches
 * the {@link BREAKPOINT_THRESHOLDS} (p95 latency or error rate), at which point
 * `abortOnFail` stops the run. The throughput reached at that point is the
 * measured breaking point — use it to size capacity and autoscaling headroom.
 *
 * Probes `/readyz` (no auth, exercises the full request pipeline + DB/Redis
 * readiness) so the result reflects infrastructure capacity, not a single
 * handler. Requires the server running: `pnpm dev`.
 *
 * Run: `pnpm load:breakpoint` (or `BASE_URL=... k6 run <this file>`).
 */
export const options = {
  scenarios: {
    health_breakpoint: {
      ...SCENARIOS.breakpoint,
      exec: 'health',
    },
  },
  thresholds: {
    ...BREAKPOINT_THRESHOLDS,
    'http_req_duration{name:health}': ['p(95)<800'],
  },
};

export function health() {
  const response = http.get(`${BASE_URL}/readyz`, {
    tags: { name: 'health' },
  });
  check(response, {
    'health status 200': (r) => r.status === 200,
  });
}

export default health;
