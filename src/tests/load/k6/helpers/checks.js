import { check } from 'k6';

/**
 * Standard response assertions for k6 tests.
 */
export function checkStatus(response, expectedStatus, name) {
  return check(response, {
    [`${name || 'response'} status is ${expectedStatus}`]: (r) =>
      r.status === expectedStatus,
  });
}

export function checkOk(response, name) {
  return check(response, {
    [`${name || 'response'} is 2xx`]: (r) =>
      r.status >= 200 && r.status < 300,
  });
}

export function checkResponseTime(response, maxMs, name) {
  return check(response, {
    [`${name || 'response'} time < ${maxMs}ms`]: (r) =>
      r.timings.duration < maxMs,
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
