import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, SCENARIOS, SMOKE_THRESHOLDS } from '../helpers/config.js';
import { checkStatus } from '../helpers/checks.js';

/**
 * Stripe webhook ingest throughput (unsigned body — expect 400 without signature).
 * Validates the route stays responsive under load.
 */
export const options = {
  scenarios: {
    stripeWebhookIngest: { ...SCENARIOS.smoke, exec: 'stripeWebhookIngest' },
  },
  thresholds: {
    ...SMOKE_THRESHOLDS,
    'http_req_duration{name:stripe-webhook-ingest}': ['p(95)<400', 'p(99)<800'],
  },
};

export function stripeWebhookIngest() {
  const payload = JSON.stringify({
    id: `evt_k6_${__VU}_${__ITER}`,
    type: 'customer.subscription.updated',
    data: { object: { id: 'sub_k6' } },
  });

  const response = http.post(`${API_PREFIX}/billing/stripe/webhook`, payload, {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'stripe-webhook-ingest' },
    responseCallback: http.expectedStatuses(400),
  });

  checkStatus(response, 400, 'stripe-webhook-missing-signature');
  sleep(0.2);
}

export default stripeWebhookIngest;
