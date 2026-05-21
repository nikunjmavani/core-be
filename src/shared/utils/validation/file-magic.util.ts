/**
 * Magic byte signatures for common file types.
 * Use when validating uploads to ensure content matches declared content-type
 * (prevents malicious files disguised with wrong extensions).
 *
 * Note: Presigned URL uploads go directly to S3; magic-byte verification
 * would need to run in S3 Object Lambda or a post-upload webhook.
 */

const MAGIC_SIGNATURES: ReadonlyArray<{
  contentType: string;
  signature: Uint8Array;
  offset?: number;
}> = [
  {
    contentType: 'image/png',
    signature: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { contentType: 'image/jpeg', signature: new Uint8Array([0xff, 0xd8, 0xff]) },
  {
    contentType: 'image/webp',
    signature: new Uint8Array([0x52, 0x49, 0x46, 0x46]), // RIFF
    offset: 0,
  },
  { contentType: 'application/pdf', signature: new Uint8Array([0x25, 0x50, 0x44, 0x46]) }, // %PDF
];

/**
 * Verifies that the buffer's magic bytes match the declared content type.
 * Returns true if valid, false otherwise.
 */
export function verifyFileMagicBytes(buffer: Buffer, contentType: string): boolean {
  const entry = MAGIC_SIGNATURES.find((entry) => entry.contentType === contentType);
  if (!entry) return false;

  const offset = entry.offset ?? 0;
  const signature = entry.signature;
  const minimumLength = offset + signature.length + (contentType === 'image/webp' ? 8 : 0);

  if (buffer.length < minimumLength) return false;

  const slice = buffer.subarray(offset, offset + signature.length);
  if (!slice.equals(Buffer.from(signature))) return false;

  // WebP: RIFF at 0, WEBP at 8
  if (contentType === 'image/webp') {
    const webpMarker = Buffer.from([0x57, 0x45, 0x42, 0x50]); // WEBP
    if (!buffer.subarray(8, 12).equals(webpMarker)) return false;
  }

  return true;
}
