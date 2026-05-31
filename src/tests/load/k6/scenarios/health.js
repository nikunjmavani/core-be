import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, THRESHOLDS, SCENARIOS } from '../helpers/config.js';

/**
 * k6 Scenario: Health endpoints only
 *
 * Load test for GET /readyz.
 * No auth required — use for baseline throughput and latency.
 */
export const options = {
  scenarios: {
    health_smoke: {
      ...SCENARIOS.smoke,
      exec: 'health',
      startTime: '0s',
    },
    health_load: {
      ...SCENARIOS.load,
      exec: 'health',
      startTime: '35s',
    },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:health}': ['p(95)<300', 'p(99)<500'],
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
        const b = JSON.parse(r.body);
        return b.status === 'ok';
      } catch {
        return false;
      }
    },
  });
}

export default health;
