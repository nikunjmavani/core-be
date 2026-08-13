import http from 'k6/http';
import { sleep } from 'k6';
import { Trend } from 'k6/metrics';
import { API_PREFIX, SMOKE_THRESHOLDS } from '../helpers/config.js';
import { checkStatus } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

/**
 * k6 Scenario: SOAK — steady, unremarkable load held for a long window.
 *
 * Every other scenario in this suite is short: the longest ramp finishes in a few minutes, which
 * is exactly the window in which a slow resource leak is invisible. A connection that is checked
 * out and never returned, a Redis key set without a TTL, an unbounded in-memory cache or an
 * event-listener registered per request all look perfectly healthy for two minutes and only bend
 * the latency curve after twenty.
 *
 * The signal is NOT the absolute p95 — it is the SHAPE over time. Compare the first and last
 * quarter of the run: on a healthy service they match. A steadily climbing p95 at constant VUs
 * and constant throughput means something is accumulating.
 *
 * Deliberately modest load (default 10 VUs). Saturation is `health-stress` and `api-stress`'s
 * job; the point here is duration, not pressure.
 *
 * Run:  DURATION=30m k6 run soak.js
 *       TEST_TOKEN=<jwt> DURATION=45m VUS=10 k6 run soak.js
 */

const VUS = Number(__ENV.VUS || '10');
const DURATION = __ENV.DURATION || '30m';

/** Latency split by run half so a drift between them is visible in the summary. */
const earlyLatency = new Trend('soak_latency_first_half', true);
const lateLatency = new Trend('soak_latency_second_half', true);

export const options = {
  summaryTrendStats: ['avg', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
  scenarios: {
    soak: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
      exec: 'soakSteadyState',
    },
  },
  thresholds: {
    ...SMOKE_THRESHOLDS,
    'http_req_duration{name:soak-readyz}': ['p(95)<500'],
    'http_req_duration{name:soak-users-me}': ['p(95)<800'],
    // The leak tripwire: the back half of the run must not be dramatically slower than the
    // front half. A generous 2x bound catches accumulation without failing on ordinary noise.
    soak_latency_second_half: ['p(95)<1600'],
    soak_latency_first_half: ['p(95)<800'],
  },
};

const startedAt = Date.now();
const runMinutes = Number((DURATION.match(/^(\d+)m$/) || [])[1] || '30');
const halfwayMs = (runMinutes * 60 * 1000) / 2;

function recordHalf(durationMs) {
  if (Date.now() - startedAt < halfwayMs) {
    earlyLatency.add(durationMs);
    return;
  }
  lateLatency.add(durationMs);
}

export function soakSteadyState() {
  // Unauthenticated readiness probe — always available, and the cheapest way to see whether the
  // process itself is degrading (event-loop lag, pool starvation) independently of any route.
  const readyz = http.get(`${API_PREFIX.replace('/api/v1', '')}/readyz`, {
    tags: { name: 'soak-readyz' },
  });
  checkStatus(readyz, 200, 'readyz');
  recordHalf(readyz.timings.duration);

  const token = __ENV.TEST_TOKEN;
  if (token) {
    // One authenticated read exercises the paths a leak is most likely to live on: JWT verify,
    // a pool checkout, an RLS-scoped query and permission resolution.
    const me = http.get(`${API_PREFIX}/users/me`, {
      ...authHeaders(token),
      tags: { name: 'soak-users-me' },
    });
    checkStatus(me, 200, 'users-me');
    recordHalf(me.timings.duration);
  }

  // Slow, natural pacing — a soak measures endurance, not throughput.
  sleep(1);
}

export default soakSteadyState;
