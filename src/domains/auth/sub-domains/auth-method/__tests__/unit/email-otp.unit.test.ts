import { describe, it, expect } from 'vitest';
import {
  EMAIL_OTP_LENGTH,
  generateEmailOtp,
  hashEmailOtp,
} from '@/domains/auth/sub-domains/auth-method/email-otp.js';

describe('email-otp util', () => {
  it('generates a zero-padded numeric code of the configured length', () => {
    // Sample many times: leading-zero codes must keep full width and the charset stays numeric.
    for (let iteration = 0; iteration < 500; iteration += 1) {
      const code = generateEmailOtp();
      expect(code).toMatch(/^\d+$/);
      expect(code).toHaveLength(EMAIL_OTP_LENGTH);
    }
  });

  it('hashEmailOtp is a deterministic 64-char sha256 hex that differs per code', () => {
    expect(hashEmailOtp('123456')).toBe(hashEmailOtp('123456'));
    expect(hashEmailOtp('123456')).toMatch(/^[a-f0-9]{64}$/);
    expect(hashEmailOtp('123456')).not.toBe(hashEmailOtp('654321'));
  });
});
