import http from 'k6/http';
import { check } from 'k6';
import { BASE_URL, THRESHOLDS, SCENARIOS } from '../helpers/config.js';

/**
 * k6 Scenario: Health endpoints only
 *
 * Load test for GET /health/live and GET /health/ready.
 * No auth required — use for baseline throughput and latency.
 */
export const options = {
  scenarios: {
    health_smoke: {
      ...SCENARIOS.smoke,
      exec: 'healthLive',
      startTime: '0s',
    },
    health_load: {
      ...SCENARIOS.load,
      exec: 'healthLive',
      startTime: '35s',
    },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:health-live}': ['p(95)<100', 'p(99)<200'],
    'http_req_duration{name:health-ready}': ['p(95)<300', 'p(99)<500'],
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
        const b = JSON.parse(r.body);
        return b.status === 'ok';
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
        const b = JSON.parse(r.body);
        return b.status === 'ok';
      } catch {
        return false;
      }
    },
  });
}

export default healthLive;
