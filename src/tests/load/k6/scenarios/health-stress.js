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
      exec: 'healthLive',
    },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:health-live}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{name:health-ready}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function healthLive() {
  const liveRes = http.get(`${BASE_URL}/health/live`, {
    tags: { name: 'health-live' },
  });
  check(liveRes, {
    'health/live status 200': (r) => r.status === 200,
    'health/live body ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok';
      } catch {
        return false;
      }
    },
  });

  const readyRes = http.get(`${BASE_URL}/health/ready`, {
    tags: { name: 'health-ready' },
  });
  check(readyRes, {
    'health/ready status 200': (r) => r.status === 200,
    'health/ready body ok': (r) => {
      try {
        const body = JSON.parse(r.body);
        return body.status === 'ok';
      } catch {
        return false;
      }
    },
  });
}

export default healthLive;
