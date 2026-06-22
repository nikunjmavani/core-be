import { describe, expect, it } from 'vitest';
import { magicLinkTemplate } from '@/infrastructure/mail/templates/magic-link.template.js';

describe('magicLinkTemplate', () => {
  it('renders the 6-digit sign-in code and its TTL', () => {
    const html = magicLinkTemplate({ code: '123456', expiresInMinutes: 15 });

    expect(html).toContain('123456');
    expect(html).toContain('15 minutes');
  });

  it('HTML-escapes the code value as defence-in-depth', () => {
    const html = magicLinkTemplate({ code: '<b>42</b>', expiresInMinutes: 15 });

    expect(html).not.toContain('<b>42</b>');
    expect(html).toContain('&lt;b&gt;42&lt;/b&gt;');
  });
});
