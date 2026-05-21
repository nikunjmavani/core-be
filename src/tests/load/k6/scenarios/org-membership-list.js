import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS, SCENARIOS } from '../helpers/config.js';
import { checkOk, checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

export const options = {
  scenarios: {
    load: { ...SCENARIOS.load, exec: 'membershipListOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:list-memberships}': ['p(95)<600', 'p(99)<1200'],
  },
};

export function membershipListOps() {
  const token = __ENV.TEST_TOKEN;
  const organizationPublicId = __ENV.TEST_ORG_ID;
  if (!(token && organizationPublicId)) return;

  const headers = {
    ...authHeaders(token).headers,
    'X-Organization-Id': organizationPublicId,
  };

  const response = http.get(
    `${API_PREFIX}/tenancy/organizations/${organizationPublicId}/memberships`,
    { headers, tags: { name: 'list-memberships' } },
  );
  checkOk(response, 'list-memberships');
  checkResponseTime(response, 600, 'list-memberships');
  sleep(0.5);
}

export default membershipListOps;
