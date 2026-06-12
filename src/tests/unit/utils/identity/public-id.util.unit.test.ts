import { describe, expect, it } from 'vitest';
import { generatePublicId, PUBLIC_ID_LENGTH } from '@/shared/utils/identity/public-id.util.js';

const PUBLIC_ID_PATTERN = /^usr_[0-9a-z]{21}$/;

describe('public-id.util', () => {
  it('exports PUBLIC_ID_LENGTH as 21', () => {
    expect(PUBLIC_ID_LENGTH).toBe(21);
  });

  it('generates ids of correct length and charset', () => {
    const identifier = generatePublicId('user');
    expect(identifier).toHaveLength(PUBLIC_ID_LENGTH + 4);
    expect(identifier).toMatch(PUBLIC_ID_PATTERN);
  });

  it('generates unique ids across many calls', () => {
    const identifiers = new Set(Array.from({ length: 100 }, () => generatePublicId('user')));
    expect(identifiers.size).toBe(100);
  });
});
