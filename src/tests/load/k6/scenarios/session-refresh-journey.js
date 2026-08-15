import http from 'k6/http';
import { check, sleep } from 'k6';
import { API_PREFIX, SMOKE_THRESHOLDS } from '../helpers/config.js';
import { checkStatus } from '../helpers/checks.js';

/**
 * k6 Scenario: session lifecycle — login → Bearer read → cookie refresh → read
 * with the rotated token → logout → refresh rejected.
 *
 * This is the platform's security-heaviest auth surface (httpOnly `session_id`
 * cookie + double-submit `csrf_token` + Origin checks) and no other scenario
 * touched `/auth/refresh` or `/auth/logout` at all. k6 keeps a per-VU cookie
 * jar, so the browser contract is exercised for real: login sets both cookies,
 * refresh rides the jar and mirrors the readable `csrf_token` cookie into
 * `X-CSRF-Token` (the SPA's double-submit), logout clears the session and the
 * final refresh MUST come back 401 — a load-visible proof that logout actually
 * revokes, not just deletes a cookie client-side.
 *
 * Credentials via `DEMO_EMAIL` / `DEMO_PASSWORD` (same defaults as login-smoke).
 */
export const options = {
  scenarios: {
    sessionRefreshJourney: {
      // Iteration-bounded on purpose: `/auth/refresh` carries REFRESH_RATE_LIMIT
      // (30 req / 60s per IP) and each iteration refreshes twice — a duration-based
      // smoke loop from one IP would trip the limiter it is not trying to test.
      executor: 'shared-iterations',
      vus: 1,
      iterations: 5,
      exec: 'sessionRefreshJourney',
    },
  },
  thresholds: {
    ...SMOKE_THRESHOLDS,
    'http_req_duration{name:session-journey-login}': ['p(95)<800', 'p(99)<1200'],
    'http_req_duration{name:session-journey-refresh}': ['p(95)<500', 'p(99)<1000'],
    'http_req_duration{name:session-journey-me}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function sessionRefreshJourney() {
  const email = __ENV.DEMO_EMAIL || 'demo@example.com';
  const password = __ENV.DEMO_PASSWORD || 'DemoPassword123!';

  // 1) Login — sets the httpOnly session cookie + readable csrf_token cookie
  //    in this VU's jar and returns the short-lived Bearer token.
  const loginResponse = http.post(`${API_PREFIX}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
    tags: { name: 'session-journey-login' },
  });
  checkStatus(loginResponse, 200, 'session-journey login');
  if (loginResponse.status !== 200) {
    sleep(1);
    return;
  }
  const accessToken = JSON.parse(loginResponse.body).data?.access_token;
  if (!accessToken) {
    sleep(1);
    return;
  }

  // 2) Bearer read proves the minted token works.
  const meResponse = http.get(`${API_PREFIX}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    tags: { name: 'session-journey-me' },
  });
  checkStatus(meResponse, 200, 'session-journey me');

  // 3) Refresh — the jar sends session_id automatically; mirror the readable
  //    csrf_token cookie into X-CSRF-Token exactly as the SPA does (the
  //    double-submit contract; required in production when Origin is absent).
  const csrfCookie = findCookieValue('csrf_token');
  const refreshResponse = http.post(`${API_PREFIX}/auth/refresh`, null, {
    headers: csrfCookie ? { 'X-CSRF-Token': csrfCookie } : {},
    tags: { name: 'session-journey-refresh' },
  });
  checkStatus(refreshResponse, 200, 'session-journey refresh');
  const refreshedToken =
    refreshResponse.status === 200 ? JSON.parse(refreshResponse.body).data?.access_token : null;

  // 4) The ROTATED token must be live.
  if (refreshedToken) {
    const refreshedMeResponse = http.get(`${API_PREFIX}/users/me`, {
      headers: { Authorization: `Bearer ${refreshedToken}`, 'Content-Type': 'application/json' },
      tags: { name: 'session-journey-me' },
    });
    checkStatus(refreshedMeResponse, 200, 'session-journey me (refreshed token)');
  }

  // 5) Logout, then prove the dead session cannot refresh. Logout CLEARS both
  //    cookies (Set-Cookie), so whichever guard trips first rejects: 403 (CSRF
  //    cookie gone — the double-submit gate), 400 (missing session cookie), or
  //    401 (revoked-but-present cookie). Either way: no new token after logout.
  const logoutResponse = http.post(`${API_PREFIX}/auth/logout`, null, {
    headers: {
      Authorization: `Bearer ${refreshedToken || accessToken}`,
      'Content-Type': 'application/json',
    },
    tags: { name: 'session-journey-logout' },
  });
  checkStatus(logoutResponse, 200, 'session-journey logout');

  const postLogoutCsrfCookie = findCookieValue('csrf_token');
  const refreshAfterLogoutResponse = http.post(`${API_PREFIX}/auth/refresh`, null, {
    headers: postLogoutCsrfCookie ? { 'X-CSRF-Token': postLogoutCsrfCookie } : {},
    tags: { name: 'session-journey-refresh-after-logout' },
    // 429 included: back-to-back local runs share the per-IP refresh window, so
    // the limiter can answer first — still a rejection, still no token minted.
    responseCallback: http.expectedStatuses(400, 401, 403, 429),
  });
  check(refreshAfterLogoutResponse, {
    'session-journey refresh after logout is rejected (400/401/403/429)': (response) =>
      [400, 401, 403, 429].includes(response.status),
    'session-journey refresh after logout mints no token': (response) => {
      try {
        return !JSON.parse(response.body).data?.access_token;
      } catch {
        return true;
      }
    },
  });

  // Fresh session per iteration: clear the jar so the next loop's login starts clean.
  http.cookieJar().clear(`${API_PREFIX}`);
  sleep(1);
}

/** Reads a cookie value from this VU's jar for the API origin (null when absent). */
function findCookieValue(cookieName) {
  const cookiesForApiOrigin = http.cookieJar().cookiesForURL(`${API_PREFIX}/auth/refresh`);
  const values = cookiesForApiOrigin[cookieName];
  return values && values.length > 0 ? values[0] : null;
}
