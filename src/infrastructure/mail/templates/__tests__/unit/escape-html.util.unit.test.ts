import { describe, expect, it } from 'vitest';
import { escapeHtml } from '@/infrastructure/mail/templates/escape-html.util.js';

describe('escapeHtml', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralizes a script tag injection', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('does not double-escape an ampersand already part of an entity', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('returns plain text unchanged', () => {
    expect(escapeHtml('Acme Corporation')).toBe('Acme Corporation');
  });

  it('returns an empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });
});
