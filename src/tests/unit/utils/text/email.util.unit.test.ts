import { describe, expect, it, vi } from 'vitest';
import { DISPOSABLE_EMAIL_MESSAGE } from '@/shared/utils/text/email.util.js';

const DISPOSABLE_EMAIL = 'test@yopmail.com';
const NORMAL_EMAIL = 'user@example.com';

describe('email.util', () => {
  it('exports DISPOSABLE_EMAIL_MESSAGE', () => {
    expect(DISPOSABLE_EMAIL_MESSAGE).toBe(
      'Disposable or temporary email addresses are not allowed',
    );
  });

  describe('BLOCK_DISPOSABLE_EMAIL switch (default true)', () => {
    it('when BLOCK_DISPOSABLE_EMAIL is true (default), disposable email is blocked in any environment', async () => {
      vi.doMock('@/shared/config/env.config.js', () => ({
        getEnv: () => ({ BLOCK_DISPOSABLE_EMAIL: true }),
      }));
      await vi.resetModules();
      const mod = await import('@/shared/utils/text/email.util.js');
      expect(mod.isDisposableEmailBlocked(DISPOSABLE_EMAIL)).toBe(true);
      expect(mod.isDisposableEmailBlocked('user@mailinator.com')).toBe(true);
      expect(mod.isDisposableEmailBlocked(NORMAL_EMAIL)).toBe(false);
      expect(mod.isDisposableEmailBlocked('user@gmail.com')).toBe(false);
    });

    it('when BLOCK_DISPOSABLE_EMAIL is false, disposable email is allowed (check off)', async () => {
      vi.doMock('@/shared/config/env.config.js', () => ({
        getEnv: () => ({ BLOCK_DISPOSABLE_EMAIL: false }),
      }));
      await vi.resetModules();
      const mod = await import('@/shared/utils/text/email.util.js');
      expect(mod.isDisposableEmailBlocked(DISPOSABLE_EMAIL)).toBe(false);
      expect(mod.isDisposableEmailBlocked('user@mailinator.com')).toBe(false);
      expect(mod.isDisposableEmailBlocked(NORMAL_EMAIL)).toBe(false);
    });
  });

  describe('disposable domains', () => {
    it('blocks known disposable domains when switch is on', async () => {
      vi.doMock('@/shared/config/env.config.js', () => ({
        getEnv: () => ({ BLOCK_DISPOSABLE_EMAIL: true }),
      }));
      await vi.resetModules();
      const mod = await import('@/shared/utils/text/email.util.js');
      expect(mod.isDisposableEmailBlocked('test@yopmail.com')).toBe(true);
      expect(mod.isDisposableEmailBlocked('user@mailinator.com')).toBe(true);
    });

    it('allows normal domains when switch is on', async () => {
      vi.doMock('@/shared/config/env.config.js', () => ({
        getEnv: () => ({ BLOCK_DISPOSABLE_EMAIL: true }),
      }));
      await vi.resetModules();
      const mod = await import('@/shared/utils/text/email.util.js');
      expect(mod.isDisposableEmailBlocked('user@example.com')).toBe(false);
      expect(mod.isDisposableEmailBlocked('user@gmail.com')).toBe(false);
    });
  });
});
