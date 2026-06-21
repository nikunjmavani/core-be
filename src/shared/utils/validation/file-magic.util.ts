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
 * WebP (RIFF container) layout (audit #33): `RIFF` at bytes 0-4, the 4-byte file size at 4-8, and
 * the `WEBP` format marker at bytes 8-12 — so a valid WebP needs at least 12 bytes. Named here so
 * the bounds can't silently drift from a magic-signature edit.
 */
const WEBP_FORMAT_MARKER_OFFSET = 8;
const WEBP_FORMAT_MARKER = Buffer.from([0x57, 0x45, 0x42, 0x50]); // 'WEBP'
const WEBP_MINIMUM_LENGTH = WEBP_FORMAT_MARKER_OFFSET + WEBP_FORMAT_MARKER.length; // 12

/**
 * Returns true when {@link verifyFileMagicBytes} knows a magic-byte signature for
 * `contentType` (i.e. the type can be content-verified). Used to skip enforcement for
 * allowed-but-signature-less types (e.g. text-based SVG, which is sanitized instead).
 */
export function isMagicByteVerifiable(contentType: string): boolean {
  return MAGIC_SIGNATURES.some((entry) => entry.contentType === contentType);
}

/**
 * Verifies that the buffer's magic bytes match the declared content type.
 * Returns true if valid, false otherwise.
 */
export function verifyFileMagicBytes(buffer: Buffer, contentType: string): boolean {
  const entry = MAGIC_SIGNATURES.find((entry) => entry.contentType === contentType);
  if (!entry) return false;

  const offset = entry.offset ?? 0;
  const signature = entry.signature;
  // audit #33: WebP needs the full 12-byte RIFF+WEBP header (explicit constant, not a `+8` addend
  // that could drift if the RIFF signature/offset changes); other types need just their signature.
  const minimumLength =
    contentType === 'image/webp' ? WEBP_MINIMUM_LENGTH : offset + signature.length;

  if (buffer.length < minimumLength) return false;

  const slice = buffer.subarray(offset, offset + signature.length);
  if (!slice.equals(Buffer.from(signature))) return false;

  // WebP: 'RIFF' at 0-4 (checked above), 'WEBP' format marker at 8-12.
  if (contentType === 'image/webp') {
    const webpMarker = buffer.subarray(
      WEBP_FORMAT_MARKER_OFFSET,
      WEBP_FORMAT_MARKER_OFFSET + WEBP_FORMAT_MARKER.length,
    );
    if (!webpMarker.equals(WEBP_FORMAT_MARKER)) return false;
  }

  return true;
}
