import type { FastifyReply } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/infrastructure/observability/sentry/sentry.js', () => ({
  captureMessage: vi.fn(),
}));

import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { TEST_API_V1_PREFIX } from '@/tests/helpers/test-api-prefix.helper.js';
import {
  alertDeprecatedUsagePastSunset,
  applyDeprecatedEndpointHeaders,
  applyPublicApiVersionHeader,
  buildPublicApiPrefix,
  formatHttpDate,
  isPastSunset,
  parseHttpDate,
  PUBLIC_API_VERSION_HEADER,
  PUBLIC_API_VERSION_SEGMENT_V1,
  PUBLIC_API_VERSION_VALUE_V1,
  resetSunsetAlertThrottleForTests,
} from '@/shared/utils/http/api-versioning.util.js';

describe('api-versioning.util', () => {
  beforeEach(() => {
    resetSunsetAlertThrottleForTests();
    vi.mocked(captureMessage).mockClear();
  });

  afterEach(() => {
    resetSunsetAlertThrottleForTests();
  });
  it('buildPublicApiPrefix combines /api with segment', () => {
    expect(buildPublicApiPrefix(PUBLIC_API_VERSION_SEGMENT_V1)).toBe('/api/v1');
    expect(buildPublicApiPrefix('v2')).toBe('/api/v2');
  });

  it('formatHttpDate emits UTC IMF-fixdate', () => {
    const date = new Date('2026-06-01T12:00:00.000Z');
    expect(formatHttpDate(date)).toBe('Mon, 01 Jun 2026 12:00:00 GMT');
  });

  it('applyDeprecatedEndpointHeaders sets Sunset, Deprecation true, and optional Link', () => {
    const header = vi.fn();
    const reply = { header } as unknown as FastifyReply;
    const sunset = new Date('2026-12-31T23:59:59.000Z');
    applyDeprecatedEndpointHeaders(reply, {
      sunset,
      deprecationDocumentationUrl: 'https://example.com/docs/migrate',
    });
    expect(header).toHaveBeenCalledWith('Sunset', 'Thu, 31 Dec 2026 23:59:59 GMT');
    expect(header).toHaveBeenCalledWith('Deprecation', 'true');
    expect(header).toHaveBeenCalledWith(
      'Link',
      '<https://example.com/docs/migrate>; rel="deprecation"',
    );
  });

  it('applyDeprecatedEndpointHeaders sets dated Deprecation and combined Link', () => {
    const header = vi.fn();
    const reply = { header } as unknown as FastifyReply;
    applyDeprecatedEndpointHeaders(reply, {
      sunset: new Date('2027-01-01T00:00:00.000Z'),
      deprecation: new Date('2026-01-01T00:00:00.000Z'),
      deprecationDocumentationUrl: 'https://example.com/dep',
      sunsetDocumentationUrl: 'https://example.com/sun',
    });
    expect(header).toHaveBeenCalledWith('Sunset', 'Fri, 01 Jan 2027 00:00:00 GMT');
    expect(header).toHaveBeenCalledWith('Deprecation', 'Thu, 01 Jan 2026 00:00:00 GMT');
    expect(header).toHaveBeenCalledWith(
      'Link',
      '<https://example.com/dep>; rel="deprecation", <https://example.com/sun>; rel="sunset"',
    );
  });

  it('applyDeprecatedEndpointHeaders defaults Deprecation to true without Link headers', () => {
    const header = vi.fn();
    const reply = { header } as unknown as FastifyReply;
    applyDeprecatedEndpointHeaders(reply, {
      sunset: new Date('2027-06-01T00:00:00.000Z'),
    });
    expect(header).toHaveBeenCalledWith('Deprecation', 'true');
    expect(header).not.toHaveBeenCalledWith('Link', expect.any(String));
  });

  it('applyPublicApiVersionHeader sets API-Version', () => {
    const header = vi.fn();
    const reply = { header } as unknown as FastifyReply;
    applyPublicApiVersionHeader(reply);
    expect(header).toHaveBeenCalledWith(PUBLIC_API_VERSION_HEADER, PUBLIC_API_VERSION_VALUE_V1);
  });

  it('parseHttpDate parses IMF-fixdate and rejects invalid values', () => {
    expect(parseHttpDate('Mon, 01 Jun 2026 12:00:00 GMT')?.toISOString()).toBe(
      '2026-06-01T12:00:00.000Z',
    );
    expect(parseHttpDate('not-a-date')).toBeNull();
  });

  it('isPastSunset compares instants', () => {
    const sunset = new Date('2020-01-01T00:00:00.000Z');
    expect(isPastSunset(sunset, new Date('2021-01-01T00:00:00.000Z'))).toBe(true);
    expect(isPastSunset(sunset, new Date('2019-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('alertDeprecatedUsagePastSunset reports when sunset has passed', () => {
    alertDeprecatedUsagePastSunset({
      surface: 'test-surface',
      sunset: new Date('2020-01-01T00:00:00.000Z'),
      method: 'GET',
      url: `${TEST_API_V1_PREFIX}/example?page=1`,
    });
    expect(captureMessage).toHaveBeenCalledWith(
      'API usage past sunset: test-surface',
      expect.objectContaining({ level: 'warning' }),
    );
  });

  it('alertDeprecatedUsagePastSunset is a no-op before sunset', () => {
    alertDeprecatedUsagePastSunset({
      surface: 'test-surface',
      sunset: new Date('2099-01-01T00:00:00.000Z'),
      method: 'GET',
      url: `${TEST_API_V1_PREFIX}/example`,
    });
    expect(captureMessage).not.toHaveBeenCalled();
  });

  it('alertDeprecatedUsagePastSunset throttles duplicate surface/method/path', () => {
    const context = {
      surface: 'throttle-test',
      sunset: new Date('2020-01-01T00:00:00.000Z'),
      method: 'GET',
      url: `${TEST_API_V1_PREFIX}/items?limit=10`,
    };
    alertDeprecatedUsagePastSunset(context);
    alertDeprecatedUsagePastSunset(context);
    expect(captureMessage).toHaveBeenCalledTimes(1);
  });
});
