import { describe, expect, it } from 'vitest';
import { serializePermission } from '@/domains/tenancy/sub-domains/permission/permission.serializer.js';

const createdAt = new Date('2026-01-01T00:00:00.000Z');

describe('permission serializer', () => {
  it('serializePermission maps permission row', () => {
    expect(
      serializePermission({
        code: 'user:read',
        name: 'Read users',
        description: null,
        category: 'user',
        created_at: createdAt,
      }),
    ).toEqual({
      code: 'user:read',
      name: 'Read users',
      description: null,
      category: 'user',
      created_at: createdAt.toISOString(),
    });
  });
});
