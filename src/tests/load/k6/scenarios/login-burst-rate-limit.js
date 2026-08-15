import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';
import { API_PREFIX, SCENARIOS } from '../helpers/config.js';

/**
 * k6 Scenario: login brute-force burst — the rate limiter itself under load.
 *
 * The vitest security tier proves the login limiter's thresholds functionally;
 * nothing proved they HOLD under real concurrency. This burst hammers
 * `POST /auth/login` with a dedicated non-existent identity (never the demo
 * user, so a run cannot poison the per-email window of login-smoke or the
 * journeys) and asserts the security posture of the surface under attack-shaped
 * load:
 *
 * - every response is 401 (wrong credentials) or 429 (limiter engaged) — a 5xx
 *   under brute-force means the guard rail itself buckled,
 * - the limiter provably ENGAGES: at least one 429 must be observed
 *   (`rate_limited_responses count>0`), so a silently-disabled limiter fails
 *   the run rather than passing as "all 401s".
 *
 * Deliberately NOT in the nightly SLO gate: its residue (per-IP window) could
 * bleed into gated login scenarios; run it on demand via `pnpm load:login-burst`.
 *
 * Env awareness: `RATE_LIMIT_RELAXED_CAPS=true` (local development / the test
 * harness) lifts the strict cap to 5000/window, so a local burst legitimately
 * sees zero 429s — set `EXPECT_RATE_LIMIT=false` there. Against a hardened
 * (production-shaped) target the default applies: the limiter MUST engage.
 */
const rateLimitedResponses = new Counter('rate_limited_responses');
const serverErrorResponses = new Counter('server_error_responses');

const expectLimiterToEngage = (__ENV.EXPECT_RATE_LIMIT || 'true') === 'true';

export const options = {
  scenarios: {
    loginBurst: {
      ...SCENARIOS.smoke,
      exec: 'loginBurst',
      vus: 10,
      duration: '20s',
    },
  },
  thresholds: {
    // Hardened target: the limiter must engage at least once during the burst.
    // Relaxed-caps target (EXPECT_RATE_LIMIT=false): only prove it never 429s
    // into 5xx territory — count stays informational.
    rate_limited_responses: [expectLimiterToEngage ? 'count>0' : 'count>=0'],
    // The surface must never crumble into 5xx under brute force.
    server_error_responses: ['count==0'],
    checks: ['rate>0.99'],
  },
};

export function loginBurst() {
  const burstTargetEmail = __ENV.BURST_EMAIL || 'login-burst-nonexistent@example.com';

  const loginResponse = http.post(
    `${API_PREFIX}/auth/login`,
    JSON.stringify({ email: burstTargetEmail, password: 'DefinitelyWrongPassword123!' }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { name: 'login-burst' },
      // 401 (bad credentials) and 429 (limited) are the EXPECTED outcomes here.
      responseCallback: http.expectedStatuses(401, 429),
    },
  );

  if (loginResponse.status === 429) rateLimitedResponses.add(1);
  if (loginResponse.status >= 500) serverErrorResponses.add(1);

  check(loginResponse, {
    'login burst answers 401 or 429 (never 5xx)': (response) =>
      response.status === 401 || response.status === 429,
    'login burst response is structured JSON': (response) => {
      try {
        JSON.parse(response.body);
        return true;
      } catch {
        return false;
      }
    },
  });

  sleep(0.1);
}
