import DOMPurify from 'isomorphic-dompurify';

export const SVG_CONTENT_TYPE = 'image/svg+xml';

export function isSvgContentType(contentType: string): boolean {
  return contentType.toLowerCase() === SVG_CONTENT_TYPE;
}

/**
 * Sanitize SVG markup before serving (strips scripts, event handlers, and other XSS vectors).
 */
export function sanitizeSvgContent(svgMarkup: string): string {
  return DOMPurify.sanitize(svgMarkup, { USE_PROFILES: { svg: true, svgFilters: true } });
}

export function sanitizeSvgBuffer(buffer: Buffer): Buffer {
  const sanitized = sanitizeSvgContent(buffer.toString('utf8'));
  if (!sanitized.trim()) {
    throw new Error('svg sanitization produced empty content');
  }
  return Buffer.from(sanitized, 'utf8');
}
