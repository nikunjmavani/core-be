import {
  classifyOutboundError,
  ExternalServiceError,
} from '@/infrastructure/outbound/outbound-error.js';
import { buildOutboundCallOptions, outboundCall } from '@/infrastructure/outbound/outbound-call.js';
import { omitUndefined } from '@/shared/utils/validation/omit-undefined.util.js';
import {
  resolveOutboundDefaults,
  type OutboundIntegrationName,
} from '@/infrastructure/outbound/outbound-defaults.js';
import { redactOutboundHeaders } from '@/infrastructure/outbound/outbound-redaction.js';

const REQUEST_ID_HEADER = 'X-Request-Id';

/** Fetch-compatible callable; defaults to `globalThis.fetch` and is overridden in tests. */
export type OutboundFetchImplementation = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Resolved options accepted by {@link outboundFetch}. Use {@link buildOutboundFetchOptions}
 * to construct one from a partial {@link OutboundFetchOptionsInput} value.
 */
export interface OutboundFetchOptions {
  name: OutboundIntegrationName;
  url: string;
  init?: RequestInit;
  requestId?: string;
  fetchImplementation?: OutboundFetchImplementation;
  expectedStatus?: number | number[];
  classifyResponseError?: (response: Response, body: string) => Error | undefined;
}

/**
 * Loose form of {@link OutboundFetchOptions} that permits explicit `undefined` on each
 * optional field so callers can spread partial values without violating
 * `exactOptionalPropertyTypes`.
 */
export type OutboundFetchOptionsInput = {
  name: OutboundIntegrationName;
  url: string;
  init?: RequestInit | undefined;
  requestId?: string | undefined;
  fetchImplementation?: OutboundFetchImplementation | undefined;
  expectedStatus?: number | number[] | undefined;
  classifyResponseError?: ((response: Response, body: string) => Error | undefined) | undefined;
};

/** Strips `undefined` keys from {@link OutboundFetchOptionsInput} to produce {@link OutboundFetchOptions}. */
export function buildOutboundFetchOptions(
  options: OutboundFetchOptionsInput,
): OutboundFetchOptions {
  return omitUndefined(options) as OutboundFetchOptions;
}

function buildHeaders(options: {
  init?: RequestInit | undefined;
  requestId?: string | undefined;
}): Headers {
  const headers = new Headers(options.init?.headers);
  const requestId = options.requestId;
  if (requestId) {
    headers.set(REQUEST_ID_HEADER, requestId);
  }
  return headers;
}

function isExpectedStatus(status: number, expected: number | number[]): boolean {
  if (Array.isArray(expected)) {
    return expected.includes(status);
  }
  return status === expected;
}

async function readResponseBodyForClassification(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * HTTP outbound helper: timeout, optional circuit/retry via {@link outboundCall}, request-id header,
 * and status-based {@link ExternalServiceError} classification.
 */
export async function outboundFetch(options: OutboundFetchOptions): Promise<Response> {
  const defaults = resolveOutboundDefaults(options.name);
  const fetchImplementation = options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  const headers = buildHeaders({
    ...(options.init !== undefined ? { init: options.init } : {}),
    ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
  });

  return outboundCall(
    buildOutboundCallOptions({
      name: options.name,
      timeoutMs: defaults.timeoutMs,
      circuit: defaults.circuit ?? null,
      requestId: options.requestId,
      operation: async (signal) => {
        const response = await fetchImplementation(options.url, {
          ...options.init,
          headers,
          signal,
        });

        const expectedStatus = options.expectedStatus;
        if (expectedStatus !== undefined && !isExpectedStatus(response.status, expectedStatus)) {
          const body = await readResponseBodyForClassification(response);
          const customError = options.classifyResponseError?.(response, body);
          if (customError) {
            throw customError;
          }

          const category = response.status >= 500 ? 'http_5xx' : 'http_4xx';
          const upstreamRequestId = response.headers.get(REQUEST_ID_HEADER);
          throw new ExternalServiceError({
            integration: options.name,
            category,
            status: response.status,
            ...(upstreamRequestId ? { upstreamRequestId } : {}),
            fallbackMessage: `Outbound fetch to ${options.name} returned HTTP ${response.status}`,
          });
        }

        return response;
      },
    }),
  ).catch((error) => {
    if (error instanceof ExternalServiceError) {
      throw error;
    }
    throw classifyOutboundError(error, options.name);
  });
}

/**
 * Builds a redacted log/breadcrumb payload for an outbound HTTP attempt — header values
 * pass through {@link redactOutboundHeaders} so Authorization and API key tokens never
 * land in logs.
 */
export function buildOutboundFetchLogContext(options: {
  url: string;
  init?: RequestInit;
  requestId?: string;
}): Record<string, unknown> {
  return {
    url: options.url,
    method: options.init?.method ?? 'GET',
    requestId: options.requestId,
    headers: options.init?.headers
      ? redactOutboundHeaders(options.init.headers as Headers)
      : undefined,
  };
}
