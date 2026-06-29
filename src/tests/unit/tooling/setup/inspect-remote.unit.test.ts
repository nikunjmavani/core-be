import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupSentryProvider } from '@tooling/setup/infra/providers/setup-sentry/setup-sentry.provider.js';
import { setupPosthogProvider } from '@tooling/setup/infra/providers/setup-posthog/setup-posthog.provider.js';
import type { InfraProviderContext } from '@tooling/setup/common/types.js';

// Minimal context — inspectRemote only reads config.providers.* + secrets.* + environments.
function context(overrides: Partial<InfraProviderContext> = {}): InfraProviderContext {
  return {
    config: {
      project: { name: 'core-be', displayName: 'core-be', organization: 'albetrios' },
      environments: [
        { name: 'development', branch: 'dev' },
        { name: 'production', branch: 'main' },
      ],
      providers: {
        sentry: { enabled: true, organization: 'albetrios', project: 'core-be', platform: 'node' },
        posthog: { enabled: true, region: 'us' },
      },
    },
    secrets: { sentry: { authToken: 'tok' }, posthog: { personalApiKey: 'phx_x' } },
    state: {},
    environments: ['development', 'production'],
    applyStateUpdates: () => {},
    ...overrides,
  } as unknown as InfraProviderContext;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

afterEach(() => vi.unstubAllGlobals());

describe('Sentry inspectRemote', () => {
  it('present + in sync when remote matches config', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ slug: 'core-be', platform: 'node' })),
    );
    const result = await setupSentryProvider.inspectRemote?.(context());
    expect(result?.present).toBe(true);
    expect(result?.fields.find((f) => f.label === 'project')?.matches).toBe(true);
    expect(result?.fields.find((f) => f.label === 'platform')?.matches).toBe(true);
  });

  it('flags drift when remote platform differs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ slug: 'core-be', platform: 'python' })),
    );
    const result = await setupSentryProvider.inspectRemote?.(context());
    expect(result?.present).toBe(true);
    expect(result?.fields.find((f) => f.label === 'platform')?.matches).toBe(false);
  });

  it('absent when the project 404s', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 404 })),
    );
    const result = await setupSentryProvider.inspectRemote?.(context());
    expect(result?.present).toBe(false);
  });

  it('reports error (no throw) when token missing', async () => {
    const result = await setupSentryProvider.inspectRemote?.(
      context({ secrets: { sentry: { authToken: '' } } } as unknown as InfraProviderContext),
    );
    expect(result?.present).toBe(false);
    expect(result?.error).toMatch(/SENTRY_AUTH_TOKEN/);
  });
});

describe('PostHog inspectRemote', () => {
  it('present, compares project name from the first remote project', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ results: [{ name: 'core-be' }] })),
    );
    const result = await setupPosthogProvider.inspectRemote?.(context());
    expect(result?.present).toBe(true);
    expect(result?.fields.find((f) => f.label === 'project')?.matches).toBe(true);
  });
});
