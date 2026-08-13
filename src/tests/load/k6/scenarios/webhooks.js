import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS } from '../helpers/config.js';
import { checkStatus, checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

/**
 * k6 Scenario: Webhook Operations
 *
 * Simulates webhook management operations:
 * - List webhooks
 * - List webhook events
 */
export const options = {
  scenarios: {
    // Sustained 10 VUs rather than the ramping `load` preset. Two requests per iteration over a
    // ramp that averages ~7.5 of its 10 VUs yielded ~9.7 req/s — under the shared
    // `http_reqs: rate>10` floor, which is why an earlier revision lowered the floor to 5.
    // Holding 10 VUs for the whole run removes the ramp dilution and sustains ~19 req/s, so the
    // scenario meets the shared floor on its own throughput.
    load: { executor: 'constant-vus', vus: 10, duration: '30s', exec: 'webhookOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:list-webhooks}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:list-webhook-events}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function webhookOps() {
  const token = __ENV.TEST_TOKEN;
  if (!token) {
    console.error('TEST_TOKEN env var required');
    return;
  }

  // TEST_TOKEN must be minted scoped to TEST_ORG_ID — the active org rides the
  // token's `org` claim, so the flat webhook routes carry no org path segment.
  const headers = authHeaders(token).headers;

  // List webhooks
  const webhooksResponse = http.get(`${API_PREFIX}/notify/webhooks`, {
    headers,
    tags: { name: 'list-webhooks' },
  });
  checkStatus(webhooksResponse, 200, 'list-webhooks');
  checkResponseTime(webhooksResponse, 500, 'list-webhooks');

  sleep(0.5);

  // List webhook events
  const eventsResponse = http.get(`${API_PREFIX}/notify/webhook-events`, {
    headers,
    tags: { name: 'list-webhook-events' },
  });
  checkStatus(eventsResponse, 200, 'list-webhook-events');
  checkResponseTime(eventsResponse, 500, 'list-webhook-events');

  // 0.5s rather than 1s: keeps a realistic pause between polls while giving the run enough
  // throughput to clear the shared rate>10 floor with margin rather than by a rounding error.
  sleep(0.5);
}

export default webhookOps;
