import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  capturePostHogEvent,
  getPostHogClient,
  isPostHogInitialized,
  shutdownPostHog,
} from '@/infrastructure/observability/posthog/posthog.js';

const posthogPath = join(process.cwd(), 'src/infrastructure/observability/posthog/posthog.ts');

describe('PostHog wiring (posthog.ts)', () => {
  it('disables capture (no-op) when POSTHOG_KEY is unset', () => {
    const source = readFileSync(posthogPath, 'utf8');
    expect(source).toContain('const apiKey = env.POSTHOG_KEY');
    expect(source).toContain('PostHog product analytics disabled');
    // init returns early before constructing a client when no key is present
    expect(source).toMatch(/if \(!apiKey\) \{[\s\S]*return;/);
  });

  it('defaults the host to US cloud when POSTHOG_HOST is omitted', () => {
    const source = readFileSync(posthogPath, 'utf8');
    expect(source).toContain("const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com'");
    expect(source).toContain('env.POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST');
  });

  it('flushes pending events on shutdown', () => {
    const source = readFileSync(posthogPath, 'utf8');
    expect(source).toContain('await client.flush()');
    expect(source).toContain('client = null');
  });

  it('guards capture on an initialized client', () => {
    const source = readFileSync(posthogPath, 'utf8');
    expect(source).toContain('if (!client) return;');
    expect(source).toContain('client.capture(');
  });
});

describe('PostHog helpers when disabled', () => {
  afterEach(async () => {
    // Ensure no client lingers between tests regardless of init state.
    await shutdownPostHog();
  });

  it('reports not-initialized and returns a null client before init', () => {
    expect(isPostHogInitialized()).toBe(false);
    expect(getPostHogClient()).toBeNull();
  });

  it('capturePostHogEvent is a no-op (does not throw) when disabled', () => {
    expect(() =>
      capturePostHogEvent({
        distinctId: 'user_1',
        event: 'unit_test_event',
        properties: { source: 'unit-test' },
      }),
    ).not.toThrow();
  });

  it('shutdownPostHog resolves cleanly when disabled', async () => {
    await expect(shutdownPostHog()).resolves.toBeUndefined();
  });
});
