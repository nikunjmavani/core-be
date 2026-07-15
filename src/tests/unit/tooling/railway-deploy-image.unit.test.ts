import { describe, expect, it } from 'vitest';
import {
  buildAuthHeaders,
  isAuthorizationError,
  isRetryableHttpStatus,
  isRetryableNetworkError,
  parseOptions,
} from '@tooling/setup/railway/deploy-image.js';

const REQUIRED = ['--service', 'svc-1', '--image', 'ghcr.io/owner/api:sha'];

describe('parseOptions', () => {
  it('requires --service and --image', () => {
    expect(() => parseOptions(['--image', 'ghcr.io/owner/api:sha'])).toThrow(/--service/);
    expect(() => parseOptions(['--service', 'svc-1'])).toThrow(/--image/);
  });

  it('parses the required flags', () => {
    const options = parseOptions(REQUIRED);
    expect(options.serviceId).toBe('svc-1');
    expect(options.image).toBe('ghcr.io/owner/api:sha');
  });

  it('defaults --label to the service id so logs are never ambiguous', () => {
    expect(parseOptions(REQUIRED).label).toBe('svc-1');
    expect(parseOptions([...REQUIRED, '--label', 'worker']).label).toBe('worker');
  });

  it('defaults skipWait to false — CD must wait for terminal status', () => {
    // If this ever defaulted true, a CRASHED deployment would exit 0 and report a
    // green deploy. The workflow relies on the default; it never passes the flag.
    expect(parseOptions(REQUIRED).skipWait).toBe(false);
    expect(parseOptions([...REQUIRED, '--skip-wait']).skipWait).toBe(true);
  });

  it('rejects non-positive or non-numeric timings instead of silently coercing', () => {
    expect(() => parseOptions([...REQUIRED, '--timeout-seconds', 'abc'])).toThrow();
    expect(() => parseOptions([...REQUIRED, '--timeout-seconds', '0'])).toThrow();
    expect(() => parseOptions([...REQUIRED, '--poll-interval-seconds', '-5'])).toThrow();
  });

  it('accepts explicit timings', () => {
    const options = parseOptions([
      ...REQUIRED,
      '--timeout-seconds',
      '120',
      '--poll-interval-seconds',
      '3',
    ]);
    expect(options.timeoutSeconds).toBe(120);
    expect(options.pollIntervalSeconds).toBe(3);
  });

  it('leaves environment resolution unset unless supplied', () => {
    const options = parseOptions(REQUIRED);
    expect(options.environmentName).toBeNull();
    expect(options.environmentId).toBeNull();
    expect(parseOptions([...REQUIRED, '--environment-id', 'env-9']).environmentId).toBe('env-9');
  });
});

describe('buildAuthHeaders', () => {
  it('sends a project token as Project-Access-Token, not Bearer', () => {
    // Railway rejects a project token presented as Bearer. This branch decides
    // whether deployment-status polling is even permitted, so it is load-bearing.
    const headers = buildAuthHeaders({ token: 'tok', authMode: 'project' });
    expect(headers['Project-Access-Token']).toBe('tok');
    expect(headers.Authorization).toBeUndefined();
  });

  it('sends an account token as Bearer', () => {
    const headers = buildAuthHeaders({ token: 'tok', authMode: 'bearer' });
    expect(headers.Authorization).toBe('Bearer tok');
    expect(headers['Project-Access-Token']).toBeUndefined();
  });

  it('always declares a JSON content type', () => {
    for (const authMode of ['project', 'bearer'] as const) {
      expect(buildAuthHeaders({ token: 'tok', authMode })['Content-Type']).toBe('application/json');
    }
  });
});

describe('isRetryableHttpStatus', () => {
  it('retries rate limits and server errors', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableHttpStatus(status)).toBe(true);
    }
  });

  it('does not retry client errors — a bad token or service id must fail fast', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableHttpStatus(status)).toBe(false);
    }
  });
});

describe('isRetryableNetworkError', () => {
  it('retries transient transport failures', () => {
    for (const message of [
      'fetch failed',
      'request timed out',
      'ECONNRESET',
      'ENOTFOUND backboard.railway.com',
      'EAI_AGAIN',
    ]) {
      expect(isRetryableNetworkError(new Error(message))).toBe(true);
    }
  });

  it('does not retry a genuine application error', () => {
    expect(isRetryableNetworkError(new Error('Service not found'))).toBe(false);
  });

  it('handles a non-Error throw without crashing the retry loop', () => {
    expect(isRetryableNetworkError('fetch failed')).toBe(true);
    expect(isRetryableNetworkError(undefined)).toBe(false);
  });
});

describe('isAuthorizationError', () => {
  it('detects the auth-failure phrasings that trigger the token fallback', () => {
    expect(isAuthorizationError('Not Authorized')).toBe(true);
    expect(isAuthorizationError('unauthorized')).toBe(true);
    expect(isAuthorizationError('Forbidden resource')).toBe(true);
  });

  it('does not treat an unrelated error as an auth failure', () => {
    expect(isAuthorizationError('Deployment not found')).toBe(false);
  });
});
