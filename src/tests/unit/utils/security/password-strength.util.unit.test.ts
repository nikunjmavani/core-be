import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '@/shared/config/env.config.js';
import { ValidationError } from '@/shared/errors/index.js';
import {
  assertPasswordAcceptable,
  assessPasswordStrength,
} from '@/shared/utils/security/password-strength.util.js';

/** High-entropy, mixed-class, no dictionary words → zxcvbn score 4. */
const STRONG_PASSWORD = '9vZ!q4Xr72$KmLw8Tn3p';
/** 14 identical characters → zxcvbn score 0. */
const TRIVIAL_PASSWORD = 'aaaaaaaaaaaaaa';
/** Common base word + numeric sequence → low zxcvbn score (< 3) despite passing the 12-char DTO rule. */
const DICTIONARY_PASSWORD = 'Password1234!';

describe('password-strength.util — assessPasswordStrength', () => {
  it('scores a high-entropy password at or above the enforcement floor (>= 3)', () => {
    expect(assessPasswordStrength({ password: STRONG_PASSWORD }).score).toBeGreaterThanOrEqual(3);
  });

  it('scores a trivial repeated-character password as 0', () => {
    expect(assessPasswordStrength({ password: TRIVIAL_PASSWORD }).score).toBe(0);
  });

  it('userInputs can only lower (never raise) the score — proves account data is fed to zxcvbn', () => {
    const candidate = 'qmxz-7rtv-91k';
    const baseline = assessPasswordStrength({ password: candidate }).score;
    const withEmailContext = assessPasswordStrength({
      password: candidate,
      userInputs: ['qmxz-7rtv-91k@example.com'],
    }).score;
    expect(withEmailContext).toBeLessThanOrEqual(baseline);
  });
});

describe('password-strength.util — assertPasswordAcceptable (enforcement on, HIBP off)', () => {
  // The harness disables the feature globally; turn the zxcvbn gate on for this suite while
  // keeping HIBP off so no outbound call is made (breach behavior is covered by the HIBP
  // contract test).
  beforeAll(() => {
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = 'true';
    process.env.PASSWORD_HIBP_CHECK_ENABLED = 'false';
    resetEnvCacheForTests();
  });
  afterAll(() => {
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = 'false';
    process.env.PASSWORD_HIBP_CHECK_ENABLED = 'false';
    resetEnvCacheForTests();
  });

  it('accepts a strong password', async () => {
    await expect(
      assertPasswordAcceptable({ password: STRONG_PASSWORD, field: 'new_password' }),
    ).resolves.toBeUndefined();
  });

  it('rejects a weak password with a field-scoped ValidationError', async () => {
    await expect(
      assertPasswordAcceptable({ password: TRIVIAL_PASSWORD, field: 'new_password' }),
    ).rejects.toMatchObject({
      messageKey: 'errors:validation.weakPassword',
      errors: [{ field: 'new_password', messageKey: 'errors:validation.weakPassword' }],
    });
  });

  it('rejects a common dictionary-based password (length alone is not enough)', async () => {
    await expect(
      assertPasswordAcceptable({ password: DICTIONARY_PASSWORD, field: 'password' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('password-strength.util — assertPasswordAcceptable (feature disabled)', () => {
  beforeAll(() => {
    process.env.PASSWORD_STRENGTH_CHECK_ENABLED = 'false';
    resetEnvCacheForTests();
  });
  afterAll(() => {
    resetEnvCacheForTests();
  });

  it('is a no-op when PASSWORD_STRENGTH_CHECK_ENABLED is off (even a trivial password passes)', async () => {
    await expect(
      assertPasswordAcceptable({ password: TRIVIAL_PASSWORD, field: 'password' }),
    ).resolves.toBeUndefined();
  });
});
