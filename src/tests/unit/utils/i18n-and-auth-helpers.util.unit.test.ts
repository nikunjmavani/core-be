import { describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { translateMessageKeyPayload } from '@/shared/utils/i18n/i18n-response.util.js';
import { translateRequestMessage } from '@/shared/utils/i18n/translate-request.util.js';
import { STEP_UP_FACTORS } from '@/shared/utils/auth/recent-step-up.util.js';
import { ACTIVE_USER_STATUS } from '@/shared/utils/auth/account-status.util.js';

/**
 * Translation helpers and the two auth constants that gate account access.
 *
 * @remarks
 * Both translators are used on the response path, where the failure mode is quiet: if the
 * per-request `t` is missing and the helper has no fallback, the user sees a raw key like
 * `errors:accountNotActive` instead of a sentence. Nothing throws, and no log records it.
 */
function requestWithTranslator(
  translate?: (key: string, params?: Record<string, string | number>) => string,
  language?: string,
): FastifyRequest {
  return { t: translate, language } as unknown as FastifyRequest;
}

describe('translateRequestMessage', () => {
  it('uses the request translator when one is attached', () => {
    const translate = vi.fn(() => 'Cuenta no activa');

    const message = translateRequestMessage(
      requestWithTranslator(translate),
      'errors:accountNotActive',
      'Account is not active',
    );

    expect(message).toBe('Cuenta no activa');
    expect(translate).toHaveBeenCalledWith('errors:accountNotActive', {});
  });

  it('falls back to the supplied English string when no translator is attached', () => {
    // Worker and boot paths have no request context. Returning the key here would surface
    // `errors:accountNotActive` to a user.
    const message = translateRequestMessage(
      { t: undefined } as unknown as FastifyRequest,
      'errors:accountNotActive',
      'Account is not active',
    );

    expect(message).toBe('Account is not active');
  });

  it('forwards interpolation params to the translator', () => {
    const translate = vi.fn(() => 'Try again in 30 seconds');

    translateRequestMessage(
      requestWithTranslator(translate),
      'errors:rateLimited',
      'Try again later',
      { seconds: 30 },
    );

    expect(translate).toHaveBeenCalledWith('errors:rateLimited', { seconds: 30 });
  });

  it('passes an empty params object rather than undefined', () => {
    // i18next treats a missing options object differently from an empty one for some plural and
    // context lookups; keeping it stable avoids a class of "works in one locale" bug.
    const translate = vi.fn(() => 'ok');

    translateRequestMessage(requestWithTranslator(translate), 'k', 'fallback');

    expect(translate).toHaveBeenCalledWith('k', {});
  });

  it('returns whatever the translator returns, including an empty string', () => {
    // A locale file with a deliberately blank entry must not silently fall back to English.
    const message = translateRequestMessage(
      requestWithTranslator(() => ''),
      'k',
      'fallback',
    );

    expect(message).toBe('');
  });
});

describe('translateMessageKeyPayload', () => {
  it('translates through the request translator and returns a message envelope', () => {
    const translate = vi.fn(() => 'Plan actualizado');

    const payload = translateMessageKeyPayload(requestWithTranslator(translate), {
      messageKey: 'success:planUpdated',
    });

    expect(payload).toEqual({ message: 'Plan actualizado' });
    expect(translate).toHaveBeenCalledWith('success:planUpdated', {});
  });

  it('forwards message params', () => {
    const translate = vi.fn(() => 'Invited alice@example.com');

    translateMessageKeyPayload(requestWithTranslator(translate), {
      messageKey: 'success:invited',
      messageParams: { email: 'alice@example.com' },
    });

    expect(translate).toHaveBeenCalledWith('success:invited', { email: 'alice@example.com' });
  });

  it('falls back to i18next with the request language when no translator is attached', () => {
    // Documents a real dependency rather than asserting a value. This branch delegates to the
    // i18next singleton, which `buildApp()` initialises at boot. In an isolated unit context it is
    // NOT initialised, so `t()` resolves to undefined and the envelope carries `message:
    // undefined`. What must hold in every context is that the helper still returns the envelope
    // shape instead of throwing — a throw here would take down the response path itself.
    const payload = translateMessageKeyPayload({ language: 'en' } as unknown as FastifyRequest, {
      messageKey: 'success:planUpdated',
    });

    expect(payload).toHaveProperty('message');
  });

  it('does not throw when the request carries no language', () => {
    expect(() =>
      translateMessageKeyPayload({} as unknown as FastifyRequest, {
        messageKey: 'success:planUpdated',
      }),
    ).not.toThrow();
  });

  it('always returns exactly a `message` key', () => {
    // Controllers spread this into a response body; an extra key would leak into the API surface.
    const payload = translateMessageKeyPayload(
      requestWithTranslator(() => 'ok'),
      { messageKey: 'k' },
    );

    expect(Object.keys(payload)).toEqual(['message']);
  });
});

describe('ACTIVE_USER_STATUS', () => {
  it('is the exact literal the account guard compares against', () => {
    // The guard is an equality check, so this constant is effectively part of the auth contract:
    // a casing change here would reject every existing active user.
    expect(ACTIVE_USER_STATUS).toBe('ACTIVE');
  });
});

describe('STEP_UP_FACTORS', () => {
  it('contains exactly the three accepted factors', () => {
    expect([...STEP_UP_FACTORS]).toEqual(['password', 'mfa', 'email_code']);
  });

  it('includes email_code, which is accepted for step-up but not for destructive mutations', () => {
    // The distinction lives in a separate STRONG_STEP_UP_FACTORS list. Pinning both membership
    // and the count here means adding a factor to this list forces a deliberate decision about
    // whether it also belongs in the strong set.
    expect(STEP_UP_FACTORS).toContain('email_code');
    expect(STEP_UP_FACTORS).toHaveLength(3);
  });

  it('has no duplicates', () => {
    expect(new Set(STEP_UP_FACTORS).size).toBe(STEP_UP_FACTORS.length);
  });
});
