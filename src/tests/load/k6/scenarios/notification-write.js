import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS, SCENARIOS } from '../helpers/config.js';
import { checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

/**
 * k6 Scenario: Notification write paths
 *
 * Exercises authenticated notification state mutations:
 * - POST mark-all-read
 */
export const options = {
  scenarios: {
    load: { ...SCENARIOS.load, exec: 'notificationWriteOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:mark-all-read}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function notificationWriteOps() {
  const token = __ENV.TEST_TOKEN;
  if (!token) {
    return;
  }

  const headers = authHeaders(token).headers;

  const markAllResponse = http.post(`${API_PREFIX}/notify/notifications/mark-all-read`, null, {
    headers,
    tags: { name: 'mark-all-read' },
  });
  checkResponseTime(markAllResponse, 500, 'mark-all-read');

  sleep(1);
}

export default notificationWriteOps;
