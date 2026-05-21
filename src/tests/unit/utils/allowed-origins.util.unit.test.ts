import { describe, it, expect } from 'vitest';
import { parseAllowedOriginsList } from '@/shared/utils/security/allowed-origins.util.js';

describe('parseAllowedOriginsList', () => {
  it('splits comma-separated values and trims', () => {
    expect(parseAllowedOriginsList(' http://a , https://b ')).toEqual(['http://a', 'https://b']);
  });

  it('returns empty array for undefined or empty', () => {
    expect(parseAllowedOriginsList(undefined)).toEqual([]);
    expect(parseAllowedOriginsList('')).toEqual([]);
    expect(parseAllowedOriginsList('  ,  ')).toEqual([]);
  });
});
