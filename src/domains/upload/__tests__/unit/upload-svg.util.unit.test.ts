import { describe, expect, it } from 'vitest';
import { isSvgContentType, sanitizeSvgContent } from '@/domains/upload/utils/upload-svg.util.js';

const CRAFTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">
  <script>alert('xss')</script>
  <circle cx="50" cy="50" r="40" onclick="evil()"/>
</svg>`;

describe('upload-svg.util', () => {
  it('isSvgContentType matches image/svg+xml case-insensitively', () => {
    expect(isSvgContentType('image/svg+xml')).toBe(true);
    expect(isSvgContentType('IMAGE/SVG+XML')).toBe(true);
    expect(isSvgContentType('image/png')).toBe(false);
  });

  it('sanitizeSvgContent strips script tags and event handlers from crafted SVG', () => {
    const sanitized = sanitizeSvgContent(CRAFTED_SVG);
    expect(sanitized).not.toMatch(/<script/i);
    expect(sanitized).not.toMatch(/\bon\w+\s*=/i);
    expect(sanitized).toContain('<circle');
  });
});
