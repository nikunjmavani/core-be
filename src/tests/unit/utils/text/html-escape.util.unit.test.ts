import { describe, expect, it } from 'vitest';
import { escapeHtml as escapeHtmlForMailTemplate } from '@/infrastructure/mail/templates/escape-html.util.js';
import { escapeHtml } from '@/shared/utils/text/html-escape.util.js';

/**
 * The codebase carries TWO independent `escapeHtml` implementations:
 *
 * - `infrastructure/mail/templates/escape-html.util.ts` — single regex pass, used by the
 *   base/invitation email templates, already covered by its own suite.
 * - `shared/utils/text/html-escape.util.ts` (this one) — chained `replaceAll`, used by
 *   `notify/.../workers/notification-email-content.ts`, and previously untested.
 *
 * A duplicated XSS control where only one copy is pinned is how the two drift apart, so this
 * suite covers the notify-path implementation on its own terms and then asserts the two agree.
 */
describe('html-escape.util (notification-email path)', () => {
  it('escapes all five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it.each([
    ['&', '&amp;'],
    ['<', '&lt;'],
    ['>', '&gt;'],
    ['"', '&quot;'],
    ["'", '&#39;'],
  ])('maps %s to its entity reference', (input, expected) => {
    expect(escapeHtml(input)).toBe(expected);
  });

  it('replaces the ampersand FIRST so entities are not themselves re-escaped', () => {
    // This is the ordering invariant of the chained-replaceAll implementation. Moving the
    // `&` replacement anywhere but first turns `<` into `&amp;lt;` and renders the escaping
    // visible-but-broken in the delivered email.
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('a < b & c > d')).toBe('a &lt; b &amp; c &gt; d');
  });

  it('escapes EVERY occurrence, not just the first', () => {
    expect(escapeHtml('<<<')).toBe('&lt;&lt;&lt;');
    expect(escapeHtml('a&b&c')).toBe('a&amp;b&amp;c');
  });

  describe('injection payloads', () => {
    it('neutralizes a script tag', () => {
      expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('neutralizes an img onerror payload', () => {
      expect(escapeHtml('<img src=x onerror="alert(1)">')).toBe(
        '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
      );
    });

    it('breaks out of neither a double- nor a single-quoted attribute', () => {
      expect(escapeHtml('" onmouseover="alert(1)')).toBe('&quot; onmouseover=&quot;alert(1)');
      expect(escapeHtml("' onmouseover='alert(1)")).toBe('&#39; onmouseover=&#39;alert(1)');
    });

    it('escapes an anchor carrying a javascript: URL', () => {
      expect(escapeHtml('<a href="javascript:alert(1)">x</a>')).toBe(
        '&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;',
      );
    });
  });

  describe('pass-through and boundaries', () => {
    it('returns an empty string unchanged', () => {
      expect(escapeHtml('')).toBe('');
    });

    it('returns text with no significant characters unchanged', () => {
      expect(escapeHtml('Acme Corporation')).toBe('Acme Corporation');
    });

    it('leaves non-Latin text and emoji intact', () => {
      expect(escapeHtml('Ünïcodé — 日本語 🎉')).toBe('Ünïcodé — 日本語 🎉');
    });

    it('is NOT idempotent — escaping twice double-escapes', () => {
      // Pinned deliberately: callers must escape exactly once, at the point untrusted data
      // enters the template. If this ever changes it should be a conscious decision.
      expect(escapeHtml(escapeHtml('<'))).toBe('&amp;lt;');
    });
  });

  describe('parity with the mail-template implementation', () => {
    const corpus = [
      '',
      'Acme Corporation',
      `&<>"'`,
      '<script>alert(1)</script>',
      '<img src=x onerror="alert(1)">',
      "' onmouseover='alert(1)",
      'Tom & Jerry',
      'a < b & c > d',
      '&amp;',
      '<<<',
      'Ünïcodé — 日本語 🎉',
      'multi\nline\ttext',
    ];

    it.each(corpus)('agrees with the mail-template escaper on %j', (input) => {
      expect(escapeHtml(input)).toBe(escapeHtmlForMailTemplate(input));
    });
  });
});
