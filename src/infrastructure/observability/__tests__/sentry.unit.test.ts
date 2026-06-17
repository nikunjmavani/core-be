import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import {
  annotateSlowTransactionIfNeeded,
  extractHttpResponseStatusCode,
  getTransactionDurationMs,
  isHealthCheckTransaction,
  PRODUCTION_PROFILE_SESSION_SAMPLE_RATE,
  PRODUCTION_TRACES_SAMPLE_RATE,
  resolveTailTransactionDecision,
  resolveTracesSampleRate,
  shouldAlwaysKeepTransactionAtTail,
} from '@/infrastructure/observability/sentry/sentry-sampling.util.js';

const BASELINE = PRODUCTION_TRACES_SAMPLE_RATE;
const SLOW_MS = 3000;

const sentryPath = join(process.cwd(), 'src/infrastructure/observability/sentry/sentry.ts');
const samplingUtilPath = join(
  process.cwd(),
  'src/infrastructure/observability/sentry/sentry-sampling.util.ts',
);

describe('Sentry sampling policy (sentry.ts wiring)', () => {
  it('wires head and tail sampling from sampling util', () => {
    const sentrySource = readFileSync(sentryPath, 'utf8');
    const utilSource = readFileSync(samplingUtilPath, 'utf8');

    expect(sentrySource).toContain('tracesSampler');
    expect(sentrySource).toContain('resolveTracesSampleRate');
    expect(sentrySource).toContain('resolveTailTransactionDecision');
    expect(sentrySource).toContain('annotateSlowTransactionIfNeeded');
    expect(sentrySource).toContain('PRODUCTION_PROFILE_SESSION_SAMPLE_RATE');
    expect(sentrySource).toContain('redactSentryEvent');
    expect(sentrySource).toContain('query_string');
    expect(sentrySource).toContain('event.request.url');
    expect(utilSource).toContain('PRODUCTION_TRACES_SAMPLE_RATE = 0.05');
    expect(utilSource).toContain('PRODUCTION_PROFILE_SESSION_SAMPLE_RATE = 0.1');
  });
});

describe('resolveTracesSampleRate (head / tracesSampler)', () => {
  it('uses production baseline constants', () => {
    expect(PRODUCTION_TRACES_SAMPLE_RATE).toBe(0.05);
    expect(PRODUCTION_PROFILE_SESSION_SAMPLE_RATE).toBe(0.1);
  });

  it('does not sample health-check transactions', () => {
    expect(resolveTracesSampleRate({ name: 'GET /livez' }, BASELINE, SLOW_MS)).toBe(0);
    expect(resolveTracesSampleRate({ name: 'GET /readyz' }, BASELINE, SLOW_MS)).toBe(0);
  });

  it('returns baseline rate for ordinary successful requests', () => {
    expect(
      resolveTracesSampleRate(
        {
          name: 'GET /api/v1/tenancy/organizations',
          attributes: { 'http.response.status_code': 200 },
        },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(BASELINE);
  });

  it('uses inheritOrSampleWith when provided', () => {
    const inheritOrSampleWith = (fallbackRate: number) => fallbackRate * 2;
    expect(
      resolveTracesSampleRate(
        { name: 'GET /api/v1/user/me', inheritOrSampleWith },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(BASELINE * 2);
  });

  it('always samples 5xx responses at 100%', () => {
    expect(
      resolveTracesSampleRate(
        { name: 'POST /api/v1/auth/login', attributes: { 'http.response.status_code': 503 } },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(1.0);
  });

  it('always samples 4xx responses at 100% when status is available at head', () => {
    expect(
      resolveTracesSampleRate(
        { name: 'GET /api/v1/user/me', attributes: { 'http.response.status_code': 404 } },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(1.0);
  });

  it('always samples transactions with error in the name at 100%', () => {
    expect(resolveTracesSampleRate({ name: 'GET /error' }, BASELINE, SLOW_MS)).toBe(1.0);
  });

  it('always samples billing API routes at 100%', () => {
    expect(
      resolveTracesSampleRate(
        { name: 'GET /api/v1/billing/plans', attributes: { 'http.response.status_code': 200 } },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(1.0);
  });

  it('always samples Stripe webhook route at 100%', () => {
    expect(
      resolveTracesSampleRate(
        {
          name: 'POST /api/v1/billing/webhook',
          attributes: { 'http.response.status_code': 200 },
        },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(1.0);
  });

  it('always samples slow requests at 100% when duration is available at head', () => {
    expect(
      resolveTracesSampleRate(
        {
          name: 'GET /api/v1/user/me',
          attributes: { 'http.server.request.duration_ms': SLOW_MS },
        },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe(1.0);
  });
});

describe('resolveTailTransactionDecision (tail / beforeSendTransaction)', () => {
  it('drops health-check transactions', () => {
    expect(resolveTailTransactionDecision({ transaction: 'GET /livez' }, BASELINE, SLOW_MS)).toBe(
      'drop',
    );
    expect(resolveTailTransactionDecision({ transaction: 'GET /readyz' }, BASELINE, SLOW_MS)).toBe(
      'drop',
    );
  });

  it('always keeps 5xx transactions at 100%', () => {
    expect(
      resolveTailTransactionDecision(
        {
          transaction: 'POST /api/v1/auth/login',
          tags: { 'http.response.status_code': 503 },
          start_timestamp: 1,
          timestamp: 2,
        },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe('keep');
  });

  it('always keeps 4xx transactions at 100%', () => {
    expect(
      resolveTailTransactionDecision(
        {
          transaction: 'GET /api/v1/user/me',
          tags: { 'http.status_code': 404 },
          start_timestamp: 1,
          timestamp: 1.1,
        },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe('keep');
  });

  it('always keeps slow transactions at 100%', () => {
    expect(
      resolveTailTransactionDecision(
        {
          transaction: 'GET /api/v1/user/me',
          start_timestamp: 0,
          timestamp: SLOW_MS / 1000,
        },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe('keep');
  });

  it('always keeps billing and webhook routes at 100%', () => {
    expect(
      resolveTailTransactionDecision(
        { transaction: 'GET /api/v1/billing/plans', start_timestamp: 0, timestamp: 0.1 },
        BASELINE,
        SLOW_MS,
      ),
    ).toBe('keep');
  });

  it('applies deterministic baseline sampling to fast successful requests', () => {
    const fastSuccessfulRequest = {
      transaction: 'GET /api/v1/tenancy/organizations',
      tags: { 'http.response.status_code': 200 },
      start_timestamp: 0,
      timestamp: 0.05,
    };

    let keepEventId: string | undefined;
    let dropEventId: string | undefined;
    for (let index = 0; index < 500; index += 1) {
      const eventId = `tail-sample-probe-${index}`;
      const decision = resolveTailTransactionDecision(
        omitUndefined({ ...fastSuccessfulRequest, event_id: eventId }),
        BASELINE,
        SLOW_MS,
      );
      if (decision === 'keep' && keepEventId === undefined) {
        keepEventId = eventId;
      }
      if (decision === 'drop' && dropEventId === undefined) {
        dropEventId = eventId;
      }
      if (keepEventId && dropEventId) {
        break;
      }
    }

    expect(keepEventId).toBeDefined();
    expect(dropEventId).toBeDefined();
    expect(
      resolveTailTransactionDecision(
        omitUndefined({ ...fastSuccessfulRequest, event_id: keepEventId }),
        BASELINE,
        SLOW_MS,
      ),
    ).toBe('keep');
    expect(
      resolveTailTransactionDecision(
        omitUndefined({ ...fastSuccessfulRequest, event_id: dropEventId }),
        BASELINE,
        SLOW_MS,
      ),
    ).toBe('drop');
  });
});

describe('transaction tail helpers', () => {
  it('detects health checks', () => {
    expect(isHealthCheckTransaction('GET /livez')).toBe(true);
    expect(isHealthCheckTransaction('GET /readyz')).toBe(true);
    expect(isHealthCheckTransaction('GET /api/v1/tenancy/organizations')).toBe(false);
  });

  it('extracts HTTP status from tags and contexts', () => {
    expect(extractHttpResponseStatusCode({ tags: { 'http.response.status_code': 500 } })).toBe(500);
    expect(extractHttpResponseStatusCode({ contexts: { response: { status_code: 401 } } })).toBe(
      401,
    );
  });

  it('computes duration in milliseconds', () => {
    expect(getTransactionDurationMs({ start_timestamp: 10, timestamp: 10.5 })).toBe(500);
  });

  it('annotates slow transactions', () => {
    expect(
      annotateSlowTransactionIfNeeded(
        { start_timestamp: 0, timestamp: SLOW_MS / 1000, tags: { region: 'us' } },
        SLOW_MS,
      ),
    ).toEqual({ region: 'us', slow_transaction: 'true' });
  });

  it('shouldAlwaysKeepTransactionAtTail mirrors keep rules', () => {
    expect(
      shouldAlwaysKeepTransactionAtTail(
        { transaction: 'GET /api/v1/billing/plans', start_timestamp: 0, timestamp: 0.1 },
        SLOW_MS,
      ),
    ).toBe(true);
    expect(
      shouldAlwaysKeepTransactionAtTail(
        {
          transaction: 'GET /api/v1/user/me',
          tags: { status_code: 422 },
          start_timestamp: 0,
          timestamp: 0.1,
        },
        SLOW_MS,
      ),
    ).toBe(true);
  });
});
