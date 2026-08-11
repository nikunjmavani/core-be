/**
 * k6 shared configuration for load tests.
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API_PREFIX = `${BASE_URL}/api/v1`;

/**
 * Every preset below carries a `checks` rate so a scenario cannot exit 0 while its
 * own assertions fail. Without it k6 reports check failures in the summary but still
 * exits green — `passwordless-signup` exited 0 with a check failing 23/23, and only
 * `http_req_failed` caught `webhooks` returning 403 on 100% of requests.
 */
const CHECKS_MUST_PASS = ['rate>0.99'];

export const THRESHOLDS = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'], // Less than 1% failure rate
  http_reqs: ['rate>10'], // At least 10 requests/second
  checks: CHECKS_MUST_PASS,
};

export const SMOKE_THRESHOLDS = {
  http_req_duration: ['p(95)<1000'],
  http_req_failed: ['rate<0.05'],
  checks: CHECKS_MUST_PASS,
};

/** Stricter global preset for scenarios that define per-route thresholds. */
export const STRICT_THRESHOLDS = {
  http_req_duration: ['p(95)<400', 'p(99)<800'],
  http_req_failed: ['rate<0.01'],
  checks: CHECKS_MUST_PASS,
};

/**
 * Capacity / breakpoint preset. `abortOnFail` stops the ramp at the first
 * breach so the run terminates at the system's breaking point instead of
 * hammering a saturated server. Pair with `SCENARIOS.breakpoint`.
 */
export const BREAKPOINT_THRESHOLDS = {
  http_req_duration: [{ threshold: 'p(95)<800', abortOnFail: true, delayAbortEval: '10s' }],
  http_req_failed: [{ threshold: 'rate<0.02', abortOnFail: true, delayAbortEval: '10s' }],
};

/**
 * Standard scenario presets for reuse.
 */
export const SCENARIOS = {
  smoke: {
    executor: 'constant-vus',
    vus: 1,
    duration: '30s',
  },
  load: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '1m', target: 10 },
      { duration: '30s', target: 0 },
    ],
  },
  stress: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '30s', target: 20 },
      { duration: '1m', target: 50 },
      { duration: '30s', target: 100 },
      { duration: '30s', target: 0 },
    ],
  },
  spike: {
    executor: 'ramping-vus',
    startVUs: 0,
    stages: [
      { duration: '10s', target: 100 },
      { duration: '30s', target: 100 },
      { duration: '10s', target: 0 },
    ],
  },
  soak: {
    executor: 'constant-vus',
    vus: 10,
    duration: '10m',
  },
  /**
   * Capacity / breakpoint profile: ramps the *arrival rate* (requests/second,
   * decoupled from VU count) until the system saturates. Pair with
   * {@link BREAKPOINT_THRESHOLDS} (abortOnFail) so the run stops at the first
   * breach — the throughput at that point is the measured breaking point.
   */
  breakpoint: {
    executor: 'ramping-arrival-rate',
    startRate: 10,
    timeUnit: '1s',
    preAllocatedVUs: 50,
    maxVUs: 500,
    stages: [
      { duration: '30s', target: 50 },
      { duration: '2m', target: 300 },
    ],
  },
};
