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

  it('route-audit L3: rejects a purpose/target mismatch (organization-logo with for=user)', () => {
    // Pre-fix this passed validation and built an `organization-logos/undefined/...` key on a
    // user-scoped row. The purpose↔target cross-check now rejects it before key construction.
    expect(() =>
      validateCreateUpload({
        purpose: 'organization-logo',
        for: 'user',
        contentType: 'image/png',
        fileName: 'logo.png',
        fileSize: 1024,
      }),
    ).toThrow(ValidationError);
  });

  it('route-audit L3: rejects avatar with for=organization', () => {
    expect(() =>
      validateCreateUpload({
        purpose: 'avatar',
        for: 'organization',
        organizationId: 'abcdefghijklmnopqrstu',
        contentType: 'image/png',
        fileName: 'photo.png',
        fileSize: 1024,
      }),
    ).toThrow(ValidationError);
  });

  it('route-audit L3: accepts a matching organization purpose/target', () => {
    const input = {
      purpose: 'organization-logo',
      for: 'organization',
      organizationId: 'abcdefghijklmnopqrstu',
      contentType: 'image/png',
      fileName: 'logo.png',
      fileSize: 1024,
    };
    expect(validateCreateUpload(input)).toEqual(input);
  });
});
