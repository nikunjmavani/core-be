import http from 'k6/http';
import { API_PREFIX } from './config.js';

/**
 * Perform login and return access token.
 * Uses the test user credentials set in environment variables.
 */
export function login(email, password) {
  const response = http.post(`${API_PREFIX}/auth/login`, JSON.stringify({ email, password }), {
    headers: { 'Content-Type': 'application/json' },
  });

  if (response.status === 200) {
    const body = JSON.parse(response.body);
    return body.data?.access_token || body.data?.token || null;
  }
  return null;
}

/**
 * Build authorization headers for authenticated requests.
 */
export function authHeaders(token) {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  };
}
