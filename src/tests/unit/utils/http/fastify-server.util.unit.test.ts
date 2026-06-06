import { describe, expect, it, vi } from 'vitest';
import { IncomingMessage } from 'node:http';
import {
  PINO_REDACT_PATHS,
  buildFastifyServerOptions,
} from '@/shared/utils/http/fastify-server.util.js';

const envState = vi.hoisted(() => ({
  LOG_LEVEL: 'info',
  NODE_ENV: 'test' as string,
  TRUST_PROXY: false as boolean | number | undefined,
  FASTIFY_REQUEST_TIMEOUT_MS: undefined as number | undefined,
  FASTIFY_CONNECTION_TIMEOUT_MS: undefined as number | undefined,
}));

vi.mock('@/shared/config/env.config.js', () => ({
  get env() {
    return envState;
  },
  // Defensive: other modules pulled into the same fork (e.g. the Redis key-prefix
  // resolver) call getEnv(); expose it so this mock never poisons a co-located suite.
  getEnv: () => envState,
}));

describe('fastify-server.util', () => {
  it('exports redact paths for sensitive fields', () => {
    expect(PINO_REDACT_PATHS).toContain('authorization');
    expect(PINO_REDACT_PATHS).toContain('req.headers.cookie');
  });

  it('buildFastifyServerOptions uses env log level and disables trust proxy in test', () => {
    const options = buildFastifyServerOptions();
    expect(options.logger).toMatchObject({ level: 'info' });
    expect(options.trustProxy).toBe(false);
    expect(options.bodyLimit).toBe(1_048_576);
    expect(options.requestTimeout).toBe(30_000);
    expect(options.connectionTimeout).toBe(10_000);
  });

  it('buildFastifyServerOptions honors FASTIFY_REQUEST_TIMEOUT_MS and FASTIFY_CONNECTION_TIMEOUT_MS', async () => {
    envState.FASTIFY_REQUEST_TIMEOUT_MS = 45_000;
    envState.FASTIFY_CONNECTION_TIMEOUT_MS = 15_000;
    vi.resetModules();
    const { buildFastifyServerOptions: buildTimeoutOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    const options = buildTimeoutOptions();
    expect(options.requestTimeout).toBe(45_000);
    expect(options.connectionTimeout).toBe(15_000);
    envState.FASTIFY_REQUEST_TIMEOUT_MS = undefined;
    envState.FASTIFY_CONNECTION_TIMEOUT_MS = undefined;
    vi.resetModules();
  });

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it('genReqId ALWAYS mints a server-side UUID even when a well-formed inbound x-request-id is supplied (sec-C/M #27)', () => {
    // The prior implementation promoted the inbound client value to the
    // authoritative correlation id used by Sentry tags and Pino logs — an
    // attacker could pollute incident triage by replaying a victim's id or
    // planting a chosen id to bait on-call. The client value is now surfaced
    // separately via `extractClientSuppliedRequestIdentifier` (and exposed as
    // `x-client-request-id` in responses + a `clientRequestId` log field) but
    // never becomes the primary id.
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': 'trace-abc' };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(UUID_PATTERN);
    expect(requestIdentifier).not.toBe('trace-abc');
  });

  it('genReqId mints a server-side UUID even when a well-formed inbound UUID is supplied (sec-C/M #27)', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    const inboundUuid = '550e8400-e29b-41d4-a716-446655440000';
    incomingMessage.headers = { 'x-request-id': inboundUuid };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(UUID_PATTERN);
    expect(requestIdentifier).not.toBe(inboundUuid);
  });

  it('genReqId rejects a malformed x-request-id and generates a server-side id', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': 'bad id with spaces/and:chars' };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(UUID_PATTERN);
  });

  it('genReqId rejects an oversized x-request-id and generates a server-side id', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': 'a'.repeat(129) };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(UUID_PATTERN);
  });

  it('genReqId rejects an oversized array header value and generates a server-side id', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': ['x'.repeat(200), 'ignored'] };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(UUID_PATTERN);
  });

  it('disables trust proxy when TRUST_PROXY is unset', async () => {
    envState.NODE_ENV = 'production';
    envState.TRUST_PROXY = undefined;
    vi.resetModules();
    const { buildFastifyServerOptions: buildProductionOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildProductionOptions().trustProxy).toBe(false);
    envState.NODE_ENV = 'test';
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('honors TRUST_PROXY hop count', async () => {
    envState.TRUST_PROXY = 2;
    vi.resetModules();
    const { buildFastifyServerOptions: buildHopCountOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildHopCountOptions().trustProxy).toBe(2);
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('genReqId mints a server-side UUID even when x-request-id is an array (sec-C/M #27)', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': ['trace-array', 'ignored'] };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(UUID_PATTERN);
    expect(requestIdentifier).not.toBe('trace-array');
  });

  it('honors explicit TRUST_PROXY=false in production', async () => {
    envState.NODE_ENV = 'production';
    envState.TRUST_PROXY = false;
    vi.resetModules();
    const { buildFastifyServerOptions: buildProductionOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildProductionOptions().trustProxy).toBe(false);
    envState.NODE_ENV = 'test';
    vi.resetModules();
  });

  it('does not enable unbounded trust proxy from a boolean true value', async () => {
    envState.TRUST_PROXY = true;
    envState.NODE_ENV = 'test';
    vi.resetModules();
    const { buildFastifyServerOptions: buildTrustedProxyOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    expect(buildTrustedProxyOptions().trustProxy).toBe(false);
    envState.TRUST_PROXY = false;
    vi.resetModules();
  });

  it('genReqId generates UUID when header is absent', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = {};

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('genReqId generates UUID when x-request-id header is empty', () => {
    const options = buildFastifyServerOptions();
    const incomingMessage = new IncomingMessage({} as never);
    incomingMessage.headers = { 'x-request-id': '' };

    const requestIdentifier = options.genReqId?.(incomingMessage as never);
    expect(requestIdentifier).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('uses pino-pretty transport in local environment', async () => {
    envState.NODE_ENV = 'local';
    envState.TRUST_PROXY = false;
    vi.resetModules();
    const { buildFastifyServerOptions: buildLocalOptions } = await import(
      '@/shared/utils/http/fastify-server.util.js'
    );
    const options = buildLocalOptions();
    expect(options.logger).toMatchObject({
      transport: expect.objectContaining({ target: 'pino-pretty' }),
    });
    envState.NODE_ENV = 'test';
    vi.resetModules();
  });
});
