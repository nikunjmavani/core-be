/**
 * k6 shared configuration for load tests.
 */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
export const API_PREFIX = `${BASE_URL}/api/v1`;

export const THRESHOLDS = {
  http_req_duration: ['p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'], // Less than 1% failure rate
  http_reqs: ['rate>10'], // At least 10 requests/second
};

export const SMOKE_THRESHOLDS = {
  http_req_duration: ['p(95)<1000'],
  http_req_failed: ['rate<0.05'],
};

/** Stricter global preset for scenarios that define per-route thresholds. */
export const STRICT_THRESHOLDS = {
  http_req_duration: ['p(95)<400', 'p(99)<800'],
  http_req_failed: ['rate<0.01'],
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
};
