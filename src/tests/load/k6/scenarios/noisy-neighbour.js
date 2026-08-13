import http from 'k6/http';
import { sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { API_PREFIX, STRICT_THRESHOLDS } from '../helpers/config.js';
import { checkStatus } from '../helpers/checks.js';
import { authHeaders, switchToOrganization } from '../helpers/auth.js';

/**
 * k6 Scenario: NOISY NEIGHBOUR — one tenant saturates shared infrastructure while a second
 * tenant measures its own latency.
 *
 * Every other org-scoped scenario loads a SINGLE organization, so it can only ever answer "is
 * the system fast when one tenant is busy?". The question that actually matters for a shared
 * multi-tenant deployment is different: when one organization hammers the API, does a quiet
 * organization next door still get served? Everything contended here is shared — the Postgres
 * pool, the Redis permission cache, the rate-limit store and the event loop — so a regression in
 * per-tenant fairness (a missing per-org rate limit, an unbounded query, a pool checkout held
 * across an await) shows up as the victim's p95 tracking the aggressor's load.
 *
 * The assertion lives on the VICTIM tag alone. The aggressor is expected to be slow and to eat
 * 429s — that is the system working. Only `noisy-victim` carries an SLO, so the run fails
 * exactly when isolation fails.
 *
 * Requires two org-scoped identities:
 *   AGGRESSOR_TOKEN + AGGRESSOR_ORG_ID   — the organization generating load
 *   VICTIM_TOKEN    + VICTIM_ORG_ID      — the quiet organization being measured
 * Generate both with `pnpm tool:load-test-credentials` (two different orgs).
 *
 * Run:  AGGRESSOR_TOKEN=... AGGRESSOR_ORG_ID=... VICTIM_TOKEN=... VICTIM_ORG_ID=... \
 *         k6 run noisy-neighbour.js
 */

const AGGRESSOR_VUS = Number(__ENV.AGGRESSOR_VUS || '40');
const DURATION = __ENV.DURATION || '2m';

/** Victim latency recorded separately so tenant isolation is readable at a glance. */
const victimLatency = new Trend('victim_latency', true);

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios: {
    // The aggressor ramps hard on list endpoints that touch the pool and the permission cache.
    aggressor: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: AGGRESSOR_VUS },
        { duration: DURATION, target: AGGRESSOR_VUS },
        { duration: '10s', target: 0 },
      ],
      exec: 'aggressorLoad',
    },
    // The victim stays at a single, politely-paced VU for the whole run.
    victim: {
      executor: 'constant-vus',
      vus: 1,
      duration: DURATION,
      startTime: '20s', // begin only once the aggressor is at full tilt
      exec: 'victimProbe',
    },
  },
  thresholds: {
    ...STRICT_THRESHOLDS,
    // THE ASSERTION: a quiet tenant stays fast while a loud one saturates shared infrastructure.
    'http_req_duration{name:noisy-victim}': ['p(95)<800', 'p(99)<1500'],
    victim_latency: ['p(95)<800'],
    // The aggressor is allowed to be slow and to be rate-limited; it carries no latency bound.
    // Its failures are still capped so a totally broken API cannot pass as "expected pressure".
    'http_req_failed{name:noisy-aggressor}': ['rate<0.60'],
  },
};

function scopedToken(token, organizationPublicId) {
  if (!(token && organizationPublicId)) return null;
  return switchToOrganization(token, organizationPublicId) || token;
}

export function aggressorLoad() {
  const token = scopedToken(__ENV.AGGRESSOR_TOKEN, __ENV.AGGRESSOR_ORG_ID);
  if (!token) {
    sleep(1);
    return;
  }

  // Deliberately the heaviest org-scoped reads: both resolve permissions and hit the pool.
  http.get(`${API_PREFIX}/tenancy/organization/memberships`, {
    ...authHeaders(token),
    tags: { name: 'noisy-aggressor' },
    // 429 is the rate limiter doing its job — not a failure of the system under test.
    responseCallback: http.expectedStatuses(200, 429),
  });

  http.get(`${API_PREFIX}/tenancy/organization/roles`, {
    ...authHeaders(token),
    tags: { name: 'noisy-aggressor' },
    responseCallback: http.expectedStatuses(200, 429),
  });
}

export function victimProbe() {
  const token = scopedToken(__ENV.VICTIM_TOKEN, __ENV.VICTIM_ORG_ID);
  if (!token) {
    sleep(1);
    return;
  }

  const response = http.get(`${API_PREFIX}/tenancy/organization/memberships`, {
    ...authHeaders(token),
    tags: { name: 'noisy-victim' },
  });
  checkStatus(response, 200, 'victim-memberships');
  victimLatency.add(response.timings.duration);

  // One request per second — a quiet tenant, by construction.
  sleep(1);
}

export default victimProbe;
