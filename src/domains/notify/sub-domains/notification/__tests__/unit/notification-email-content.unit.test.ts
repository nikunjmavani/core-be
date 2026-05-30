import { describe, expect, it } from 'vitest';
import { buildNotificationEmailHtml } from '@/domains/notify/sub-domains/notification/workers/notification-email-content.js';

describe('buildNotificationEmailHtml', () => {
  it('escapes HTML in title, message, and actionUrl while keeping a plain-text subject', () => {
    const { subject, html } = buildNotificationEmailHtml({
      title: '<script>alert(1)</script>',
      message: 'Hello & "world"',
      actionUrl: 'https://example.com/?q=<x>',
    });

    // Subject is a plain-text email header (not an HTML context), so it stays unescaped.
    expect(subject).toBe('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('Hello &amp; &quot;world&quot;');
    expect(html).toContain('href="https://example.com/?q=&lt;x&gt;"');
    expect(html).not.toContain('<script>');
  });

  it('omits action button when actionUrl is absent', () => {
    const { html } = buildNotificationEmailHtml({
      title: 'Title',
      message: 'Body',
    });

    expect(html).not.toContain('class="button"');
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    'not-a-url',
    '//evil.example.com',
  ])('drops the action button for unsafe or non-http(s) actionUrl: %s', (actionUrl) => {
    const { html } = buildNotificationEmailHtml({
      title: 'Title',
      message: 'Body',
      actionUrl,
    });

    expect(html).not.toContain('class="button"');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('href="data:');
  });

  it('keeps the action button for a valid http(s) URL', () => {
    const { html } = buildNotificationEmailHtml({
      title: 'Title',
      message: 'Body',
      actionUrl: 'http://example.com/path',
    });

    expect(html).toContain('class="button"');
    expect(html).toContain('href="http://example.com/path"');
  });
});
