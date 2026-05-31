import { describe, expect, it } from 'vitest';
import {
  escapeLikePattern,
  trimmedEmail,
  trimmedSlug,
  trimmedString,
  trimmedStringMinMax,
} from '@/shared/utils/validation/validation.util.js';

describe('validation.util', () => {
  describe('trimmedString', () => {
    it('trims whitespace', () => {
      expect(trimmedString().parse('  hello  ')).toBe('hello');
    });
  });

  describe('trimmedStringMinMax', () => {
    it('enforces min and max after trim', () => {
      expect(trimmedStringMinMax(2, 5).parse(' ab ')).toBe('ab');
      expect(() => trimmedStringMinMax(2, 5).parse(' a ')).toThrow();
      expect(() => trimmedStringMinMax(2, 5).parse(' abcdef ')).toThrow();
    });
  });

  describe('trimmedSlug', () => {
    it('accepts valid lowercase slug', () => {
      expect(trimmedSlug().parse('demo-org')).toBe('demo-org');
    });

    it('rejects invalid slug characters', () => {
      expect(() => trimmedSlug().parse('Demo Org')).toThrow();
      expect(() => trimmedSlug().parse('demo_org')).toThrow();
    });

    it('rejects empty slug after trim', () => {
      expect(() => trimmedSlug().parse('   ')).toThrow();
    });
  });

  describe('escapeLikePattern', () => {
    it('escapes SQL LIKE wildcards and backslashes', () => {
      expect(escapeLikePattern('100%_off\\sale')).toBe('100\\%\\_off\\\\sale');
    });

    it('leaves strings without wildcards unchanged', () => {
      expect(escapeLikePattern('acme')).toBe('acme');
    });
  });

  describe('trimmedEmail', () => {
    it('accepts valid email and lowercases it', () => {
      expect(trimmedEmail().parse('User@Example.COM')).toBe('user@example.com');
    });

    it('trims whitespace', () => {
      expect(trimmedEmail().parse('  user@example.com  ')).toBe('user@example.com');
    });

    it('rejects invalid email format', () => {
      expect(() => trimmedEmail().parse('not-an-email')).toThrow();
      expect(() => trimmedEmail().parse('@nodomain.com')).toThrow();
    });

    it('accepts non-Gmail addresses with plus in local part', () => {
      expect(trimmedEmail().parse('user+tag@example.com')).toBe('user+tag@example.com');
      expect(trimmedEmail().parse('user+label@company.co.uk')).toBe('user+label@company.co.uk');
    });

    it('rejects Gmail addresses with plus in local part', () => {
      expect(() => trimmedEmail().parse('user+tag@gmail.com')).toThrow();
      expect(() => trimmedEmail().parse('user+label@gmail.com')).toThrow();
      expect(() => trimmedEmail().parse('  name+filter@GMAIL.COM  ')).toThrow();
    });

    it('rejects Googlemail addresses with plus in local part', () => {
      expect(() => trimmedEmail().parse('user+tag@googlemail.com')).toThrow();
    });

    it('accepts Gmail and Googlemail without plus', () => {
      expect(trimmedEmail().parse('user@gmail.com')).toBe('user@gmail.com');
      expect(trimmedEmail().parse('user@googlemail.com')).toBe('user@googlemail.com');
    });
  });
});
