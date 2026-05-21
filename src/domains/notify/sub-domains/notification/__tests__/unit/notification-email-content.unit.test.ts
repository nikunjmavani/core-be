import { describe, expect, it } from 'vitest';
import { buildNotificationEmailHtml } from '@/domains/notify/sub-domains/notification/workers/notification-email-content.js';

describe('buildNotificationEmailHtml', () => {
  it('escapes HTML in title, message, and actionUrl', () => {
    const { subject, html } = buildNotificationEmailHtml({
      title: '<script>alert(1)</script>',
      message: 'Hello & "world"',
      actionUrl: 'https://example.com/?q=<x>',
    });

    expect(subject).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
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
});
