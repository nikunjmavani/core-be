import { describe, it, expect } from 'vitest';
import { serializeUploadCreate } from '@/domains/upload/upload.serializer.js';

describe('serializeUploadCreate', () => {
  it('maps presign response fields', () => {
    const expiresAt = new Date('2026-05-16T12:00:00.000Z');
    expect(
      serializeUploadCreate({
        id: 'abc123xyz',
        upload_url: 'https://s3.example.com/presigned',
        key: 'avatars/user/abc.png',
        expires_at: expiresAt,
        upload_method: 'PUT',
      }),
    ).toEqual({
      id: 'abc123xyz',
      upload_url: 'https://s3.example.com/presigned',
      key: 'avatars/user/abc.png',
      expires_at: expiresAt.toISOString(),
      upload_method: 'PUT',
    });
  });
});
