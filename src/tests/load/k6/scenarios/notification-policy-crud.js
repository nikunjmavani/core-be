import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS, SCENARIOS } from '../helpers/config.js';
import { checkOk, checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

export const options = {
  scenarios: {
    load: { ...SCENARIOS.load, exec: 'notificationPolicyCrudOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:list-notification-policies}': ['p(95)<600', 'p(99)<1200'],
  },
};

export function notificationPolicyCrudOps() {
  const token = __ENV.TEST_TOKEN;
  const organizationPublicId = __ENV.TEST_ORG_ID;
  if (!(token && organizationPublicId)) return;

  const headers = {
    ...authHeaders(token).headers,
    'X-Organization-Id': organizationPublicId,
  };

  const listResponse = http.get(
    `${API_PREFIX}/tenancy/organizations/${organizationPublicId}/notification-policies`,
    { headers, tags: { name: 'list-notification-policies' } },
  );
  checkOk(listResponse, 'list-notification-policies');
  checkResponseTime(listResponse, 600, 'list-notification-policies');
  sleep(0.5);
}

export default notificationPolicyCrudOps;
