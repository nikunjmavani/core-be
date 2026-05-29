import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, THRESHOLDS, SCENARIOS } from '../helpers/config.js';

/**
 * k6 Scenario: Health endpoints under stress (high concurrency).
 *
 * Ramps to 20 → 50 → 100 VUs. Use for stress testing.
 * Requires server running: pnpm dev
 */
export const options = {
  scenarios: {
    health_stress: {
      ...SCENARIOS.stress,
      exec: 'health',
    },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:health}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function health() {
  const response = http.get(`${BASE_URL}/readyz`, {
    tags: { name: 'health' },
  });
  check(response, {
    'health status 200': (r) => r.status === 200,
    'health body ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok';
      } catch {
        return false;
      }
    },
  });
}

export default health;
