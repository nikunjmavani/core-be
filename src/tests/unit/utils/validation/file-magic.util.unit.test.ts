import { describe, expect, it } from 'vitest';
import { verifyFileMagicBytes } from '@/shared/utils/validation/file-magic.util.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, ...Array(9).fill(0)]);
const PDF_SIGNATURE = Buffer.from([0x25, 0x50, 0x44, 0x46, ...Array(8).fill(0)]);

function webpBuffer(): Buffer {
  const buffer = Buffer.alloc(16);
  Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(buffer, 0);
  Buffer.from([0x57, 0x45, 0x42, 0x50]).copy(buffer, 8);
  return buffer;
}

describe('file-magic.util', () => {
  it('accepts PNG magic bytes', () => {
    const buffer = Buffer.concat([PNG_SIGNATURE, Buffer.alloc(4)]);
    expect(verifyFileMagicBytes(buffer, 'image/png')).toBe(true);
  });

  it('accepts JPEG magic bytes', () => {
    expect(verifyFileMagicBytes(JPEG_SIGNATURE, 'image/jpeg')).toBe(true);
  });

  it('accepts WebP magic bytes with WEBP marker at offset 8', () => {
    expect(verifyFileMagicBytes(webpBuffer(), 'image/webp')).toBe(true);
  });

  it('accepts PDF magic bytes', () => {
    expect(verifyFileMagicBytes(PDF_SIGNATURE, 'application/pdf')).toBe(true);
  });

  it('rejects buffer shorter than minimum length', () => {
    expect(verifyFileMagicBytes(Buffer.from([0x89]), 'image/png')).toBe(false);
  });

  it('rejects unknown content type', () => {
    expect(verifyFileMagicBytes(PNG_SIGNATURE, 'application/octet-stream')).toBe(false);
  });

  it('rejects mismatched magic bytes for declared type', () => {
    expect(verifyFileMagicBytes(JPEG_SIGNATURE, 'image/png')).toBe(false);
  });

  it('rejects WebP when WEBP marker is missing', () => {
    const buffer = Buffer.alloc(16);
    Buffer.from([0x52, 0x49, 0x46, 0x46]).copy(buffer, 0);
    expect(verifyFileMagicBytes(buffer, 'image/webp')).toBe(false);
  });
});
