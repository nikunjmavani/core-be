import type { FastifyReply } from 'fastify';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Major path segment for the current stable public HTTP API (e.g. `/api/v1/...`). */
export const PUBLIC_API_VERSION_SEGMENT_V1 = 'v1' as const;

/** Response header exposing the major API version for `/api/v1` traffic (RFC 7231 field name). */
export const PUBLIC_API_VERSION_HEADER = 'API-Version' as const;

/** Value for {@link PUBLIC_API_VERSION_HEADER} on current stable major version responses. */
export const PUBLIC_API_VERSION_VALUE_V1 = '1' as const;

/**
 * When non-null, every `/api/v1` response receives `Sunset` / `Deprecation` headers during the
 * overlap window before removal (set when `/api/v2` is announced). `null` until then.
 */
export const PUBLIC_API_V1_SUNSET: Date | null = null;

const sunsetAlertLastSentAt = new Map<string, number>();
const SUNSET_ALERT_THROTTLE_MS = 5 * 60 * 1000;

/** @internal Clears sunset alert throttle state between Vitest cases. */
export function resetSunsetAlertThrottleForTests(): void {
  sunsetAlertLastSentAt.clear();
}

/**
 * Base path for a major API version, without a trailing slash.
 * Combine with a domain segment for Fastify `prefix` (e.g. `${buildPublicApiPrefix('v1')}/auth`).
 */
export function buildPublicApiPrefix(versionSegment: string): string {
  return `/api/${versionSegment}`;
}

/**
 * Formats a `Date` as an RFC 7231 IMF-fixdate (HTTP-date), UTC.
 * Used for `Sunset` and dated `Deprecation` header values.
 */
export function formatHttpDate(date: Date): string {
  return date.toUTCString();
}

/** Parses an IMF-fixdate / HTTP-date response header value. */
export function parseHttpDate(headerValue: string): Date | null {
  const timestamp = Date.parse(headerValue);
  if (Number.isNaN(timestamp)) {
    return null;
  }
  return new Date(timestamp);
}

/** Returns true when the current (or supplied `now`) instant is at or after the surface's sunset. */
export function isPastSunset(sunset: Date, now: Date = new Date()): boolean {
  return now.getTime() >= sunset.getTime();
}

/** Context for {@link alertDeprecatedUsagePastSunset}; `surface` is the throttle key and Sentry tag. */
export type DeprecatedUsagePastSunsetContext = {
  surface: string;
  sunset: Date;
  method: string;
  url: string;
  statusCode?: number;
};

/**
 * Logs and reports continued use of a deprecated surface after its published sunset instant.
 * Throttled per surface + method + path to limit Sentry noise.
 */
export function alertDeprecatedUsagePastSunset(context: DeprecatedUsagePastSunsetContext): void {
  if (!isPastSunset(context.sunset)) {
    return;
  }

  const path = context.url.split('?')[0] ?? context.url;
  const throttleKey = `${context.surface}:${context.method}:${path}`;
  const now = Date.now();
  const lastSentAt = sunsetAlertLastSentAt.get(throttleKey) ?? 0;
  if (now - lastSentAt < SUNSET_ALERT_THROTTLE_MS) {
    return;
  }
  sunsetAlertLastSentAt.set(throttleKey, now);

  const logContext = {
    surface: context.surface,
    sunset: context.sunset.toISOString(),
    method: context.method,
    url: context.url,
    statusCode: context.statusCode,
  };

  logger.warn(logContext, 'api.deprecated_usage_past_sunset');
  captureMessage(`API usage past sunset: ${context.surface}`, {
    level: 'warning',
    extra: logContext,
  });
}

/** Sets {@link PUBLIC_API_VERSION_HEADER} on stable major-version public API responses. */
export function applyPublicApiVersionHeader(
  reply: FastifyReply,
  versionValue: string = PUBLIC_API_VERSION_VALUE_V1,
): void {
  reply.header(PUBLIC_API_VERSION_HEADER, versionValue);
}

/** Options for {@link applyDeprecatedEndpointHeaders}; controls the `Sunset`, `Deprecation`, and `Link` response headers. */
export type ApplyDeprecatedEndpointHeadersOptions = {
  /** Last date after which the resource may be removed (RFC 8594 `Sunset`). */
  sunset: Date;
  /**
   * When the resource became deprecated (RFC 9745 `Deprecation`).
   * Defaults to `true` when omitted.
   */
  deprecation?: true | Date;
  /** Optional `Link` header target with `rel="deprecation"`. */
  deprecationDocumentationUrl?: string;
  /** Optional `Link` header target with `rel="sunset"`. */
  sunsetDocumentationUrl?: string;
};

/**
 * Sets `Deprecation`, `Sunset`, and optional `Link` headers for a deprecated HTTP response.
 * Call from a route handler before sending the body (or inside `onSend` preHandlers).
 *
 * @see https://www.rfc-editor.org/rfc/rfc8594 — Sunset
 * @see https://www.rfc-editor.org/rfc/rfc9745 — Deprecation
 */
export function applyDeprecatedEndpointHeaders(
  reply: FastifyReply,
  options: ApplyDeprecatedEndpointHeadersOptions,
): void {
  reply.header('Sunset', formatHttpDate(options.sunset));

  const deprecation = options.deprecation;
  if (deprecation === undefined || deprecation === true) {
    reply.header('Deprecation', 'true');
  } else {
    reply.header('Deprecation', formatHttpDate(deprecation));
  }

  const linkParts: string[] = [];
  if (options.deprecationDocumentationUrl) {
    linkParts.push(`<${options.deprecationDocumentationUrl}>; rel="deprecation"`);
  }
  if (options.sunsetDocumentationUrl) {
    linkParts.push(`<${options.sunsetDocumentationUrl}>; rel="sunset"`);
  }
  if (linkParts.length > 0) {
    reply.header('Link', linkParts.join(', '));
  }
}
