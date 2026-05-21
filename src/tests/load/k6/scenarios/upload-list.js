import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS, SCENARIOS } from '../helpers/config.js';
import { checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

export const options = {
  scenarios: {
    load: { ...SCENARIOS.load, exec: 'uploadListOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:get-upload}': ['p(95)<500', 'p(99)<1000'],
  },
};

export function uploadListOps() {
  const token = __ENV.TEST_TOKEN;
  const uploadPublicId = __ENV.TEST_UPLOAD_PUBLIC_ID;
  if (!(token && uploadPublicId)) return;

  const response = http.get(`${API_PREFIX}/uploads/${uploadPublicId}`, {
    ...authHeaders(token),
    tags: { name: 'get-upload' },
  });
  if (response.status === 200 || response.status === 404) {
    checkResponseTime(response, 500, 'get-upload');
  }
  sleep(0.5);
}

export default uploadListOps;
