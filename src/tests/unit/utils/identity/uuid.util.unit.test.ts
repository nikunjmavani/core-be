import { describe, expect, it } from 'vitest';
import { uuidSchema } from '@/shared/utils/identity/uuid.util.js';

describe('uuid.util', () => {
  it('accepts lowercase UUID', () => {
    expect(uuidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    );
  });

  it('accepts uppercase UUID', () => {
    expect(uuidSchema.parse('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550E8400-E29B-41D4-A716-446655440000',
    );
  });

  it('rejects invalid UUID format', () => {
    expect(() => uuidSchema.parse('not-a-uuid')).toThrow();
    expect(() => uuidSchema.parse('550e8400-e29b-41d4-a716')).toThrow();
  });
});
