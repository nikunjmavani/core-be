import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, SCENARIOS, SMOKE_THRESHOLDS } from '../helpers/config.js';
import { checkStatus, checkResponseTime } from '../helpers/checks.js';

/**
 * k6 Scenario: Passwordless signup + code login
 *
 * Exercises the REAL passwordless onboarding path end-to-end, creating a UNIQUE user each
 * iteration (no fixed credentials):
 *   1. POST /auth/email/send-code   (auto-signs-up the new email)
 *   2. read `data.debug_verification_code` from the response — the TEST_MODE-only affordance
 *   3. POST /auth/email/login       (redeems the code, mints a session)
 *   4. GET  /users/me
 *
 * REQUIRES the API to run with TEST_MODE=true (a `.refine()` forbids that in production, so this
 * only ever works against a local/CI test API). Without TEST_MODE the code is never returned and
 * the scenario cannot complete — by design.
 */
export const options = {
  scenarios: {
    smoke: { ...SCENARIOS.smoke, exec: 'passwordlessSignup' },
  },
  thresholds: {
    ...SMOKE_THRESHOLDS,
    'http_req_duration{name:signup-send-code}': ['p(95)<800', 'p(99)<1200'],
    'http_req_duration{name:signup-code-login}': ['p(95)<800', 'p(99)<1200'],
    'http_req_duration{name:signup-users-me}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function passwordlessSignup() {
  const headers = { 'Content-Type': 'application/json' };
  // Unique per virtual-user + iteration so every run signs up a brand-new account.
  const email = `loadtest+${__VU}-${__ITER}-${Date.now()}@loadtest.example.com`;

  // Step 1: send code (auto-signup for a new email)
  const sendResponse = http.post(`${API_PREFIX}/auth/email/send-code`, JSON.stringify({ email }), {
    headers,
    tags: { name: 'signup-send-code' },
  });
  checkStatus(sendResponse, 200, 'send-code');
  checkResponseTime(sendResponse, 800, 'send-code');
  if (sendResponse.status !== 200) {
    sleep(1);
    return;
  }

  // Step 2: read the TEST_MODE-only debug code (absent unless the API runs with TEST_MODE=true)
  const code = JSON.parse(sendResponse.body).data?.debug_verification_code;
  if (!code) {
    // TEST_MODE not enabled on the target API — nothing more to do (see scenario docstring).
    sleep(1);
    return;
  }

  // Step 3: redeem the code
  const loginResponse = http.post(
    `${API_PREFIX}/auth/email/login`,
    JSON.stringify({ email, code }),
    { headers, tags: { name: 'signup-code-login' } },
  );
  checkStatus(loginResponse, 200, 'code-login');
  checkResponseTime(loginResponse, 800, 'code-login');
  if (loginResponse.status !== 200) {
    sleep(1);
    return;
  }

  const token = JSON.parse(loginResponse.body).data?.access_token;
  if (!token) {
    sleep(1);
    return;
  }

  // Step 4: fetch the freshly-created profile
  const meResponse = http.get(`${API_PREFIX}/users/me`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    tags: { name: 'signup-users-me' },
  });
  checkStatus(meResponse, 200, 'get-me');
  checkResponseTime(meResponse, 500, 'get-me');

  sleep(1);
}

export default passwordlessSignup;
