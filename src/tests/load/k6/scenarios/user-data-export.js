import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS, SCENARIOS } from '../helpers/config.js';
import { checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

export const options = {
  scenarios: {
    load: { ...SCENARIOS.load, exec: 'userDataExportOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:user-data-export}': ['p(95)<2000', 'p(99)<5000'],
  },
};

export function userDataExportOps() {
  const token = __ENV.TEST_TOKEN;
  if (!token) return;

  const response = http.post(
    `${API_PREFIX}/users/me/data-export`,
    JSON.stringify({}),
    {
      ...authHeaders(token),
      tags: { name: 'user-data-export' },
    },
  );
  if ([200, 201, 202, 409].includes(response.status)) {
    checkResponseTime(response, 5000, 'user-data-export');
  }
  sleep(1);
}

export default userDataExportOps;
