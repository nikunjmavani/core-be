import DOMPurify from 'isomorphic-dompurify';

/** Canonical MIME type for SVG content used across upload validators and serve paths. */
export const SVG_CONTENT_TYPE = 'image/svg+xml';

/** Case-insensitive check that a declared content type is {@link SVG_CONTENT_TYPE}. */
export function isSvgContentType(contentType: string): boolean {
  return contentType.toLowerCase() === SVG_CONTENT_TYPE;
}

/**
 * Sanitize SVG markup before serving (strips scripts, event handlers, and other XSS vectors).
 */
export function sanitizeSvgContent(svgMarkup: string): string {
  return DOMPurify.sanitize(svgMarkup, { USE_PROFILES: { svg: true, svgFilters: true } });
}

/**
 * Buffer-shaped wrapper around `sanitizeSvgContent` for use on raw S3 bytes.
 * Throws when sanitization yields an empty document so the caller can refuse
 * to serve hostile or zero-byte SVGs.
 */
export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  const sanitized = sanitizeSvgContent(buffer.toString('utf8'));
  if (!sanitized.trim()) {
    throw new Error('svg sanitization produced empty content');
  }
  return Buffer.from(sanitized, 'utf8');
}
