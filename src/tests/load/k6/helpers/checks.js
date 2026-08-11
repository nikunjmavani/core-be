import { check } from 'k6';

/**
 * Standard response assertions for k6 tests.
 */
/**
 * Asserts an exact status, or membership of an allowed set when several statuses are
 * legitimate (`checkStatus(r, [200, 404], 'get-upload')`).
 *
 * The set form is why this takes an array: `idempotency-storm` already passed one, and
 * strict `===` against an array is never true, so that check could not pass at all.
 */
export function checkStatus(response, expectedStatus, name) {
  const allowed = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus];
  return check(response, {
    [`${name || 'response'} status is ${allowed.join('|')}`]: (r) => allowed.includes(r.status),
  });
}

export function checkOk(response, name) {
  return check(response, {
    [`${name || 'response'} is 2xx`]: (r) => r.status >= 200 && r.status < 300,
  });
}

export function checkResponseTime(response, maxMs, name) {
  return check(response, {
    [`${name || 'response'} time < ${maxMs}ms`]: (r) => r.timings.duration < maxMs,
  });
}

export function checkJsonBody(response, name) {
  return check(response, {
    [`${name || 'response'} has JSON body`]: (r) => {
      try {
        JSON.parse(r.body);
        return true;
      } catch {
        return false;
      }
    },
  });
}
