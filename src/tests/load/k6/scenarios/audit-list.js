import http from 'k6/http';
import { sleep } from 'k6';
import { API_PREFIX, THRESHOLDS, SCENARIOS } from '../helpers/config.js';
import { checkOk, checkResponseTime } from '../helpers/checks.js';
import { authHeaders } from '../helpers/auth.js';

export const options = {
  scenarios: {
    load: { ...SCENARIOS.load, exec: 'auditListOps' },
  },
  thresholds: {
    ...THRESHOLDS,
    'http_req_duration{name:audit-logs-list}': ['p(95)<800', 'p(99)<1500'],
  },
};

export function auditListOps() {
  const adminToken = __ENV.ADMIN_TOKEN;
  if (!adminToken) return;

  const response = http.get(`${API_PREFIX}/audit/logs?limit=20`, {
    ...authHeaders(adminToken),
    tags: { name: 'audit-logs-list' },
  });
  checkOk(response, 'audit-logs-list');
  checkResponseTime(response, 800, 'audit-logs-list');
  sleep(0.5);
}

export default auditListOps;
