import { describe, it, expect } from 'vitest';
import { serializeUploadCreate } from '@/domains/upload/upload.serializer.js';

describe('serializeUploadCreate', () => {
  it('maps presign response fields', () => {
    const expiresAt = new Date('2026-05-16T12:00:00.000Z');
    expect(
      serializeUploadCreate({
        publicId: 'abc123xyz',
        uploadUrl: 'https://s3.example.com/presigned',
        key: 'avatars/user/abc.png',
        expiresAt,
        uploadMethod: 'PUT',
      }),
    ).toEqual({
      publicId: 'abc123xyz',
      uploadUrl: 'https://s3.example.com/presigned',
      key: 'avatars/user/abc.png',
      expiresAt: expiresAt.toISOString(),
      uploadMethod: 'PUT',
    });
  });
});
