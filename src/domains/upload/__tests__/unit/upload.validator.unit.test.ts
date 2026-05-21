import { describe, expect, it } from 'vitest';
import { ValidationError } from '@/shared/errors/index.js';
import { validateCreateUpload } from '@/domains/upload/upload.validator.js';

describe('upload.validator', () => {
  it('validateCreateUpload accepts valid upload input', () => {
    const input = {
      purpose: 'avatar',
      for: 'user',
      contentType: 'image/png',
      fileName: 'photo.png',
      fileSize: 1024,
    };
    expect(validateCreateUpload(input)).toEqual(input);
  });

  it('validateCreateUpload throws for invalid purpose', () => {
    expect(() =>
      validateCreateUpload({
        purpose: 'invalid',
        for: 'user',
        contentType: 'image/png',
        fileName: 'photo.png',
        fileSize: 1024,
      }),
    ).toThrow(ValidationError);
  });

  it('validateCreateUpload throws for missing required fields', () => {
    expect(() => validateCreateUpload({})).toThrow(ValidationError);
  });

  it('validateCreateUpload rejects non-positive fileSize', () => {
    expect(() =>
      validateCreateUpload({
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'photo.png',
        fileSize: 0,
      }),
    ).toThrow(ValidationError);
  });

  it('validateCreateUpload rejects strict unknown keys', () => {
    expect(() =>
      validateCreateUpload({
        purpose: 'avatar',
        for: 'user',
        contentType: 'image/png',
        fileName: 'photo.png',
        fileSize: 1024,
        extra: true,
      }),
    ).toThrow(ValidationError);
  });
});
