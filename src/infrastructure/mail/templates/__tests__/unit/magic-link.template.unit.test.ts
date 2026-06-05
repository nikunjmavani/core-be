import { describe, expect, it } from 'vitest';
import { magicLinkTemplate } from '@/infrastructure/mail/templates/magic-link.template.js';

describe('magicLinkTemplate HTML escaping', () => {
  it('renders a safe URL without alteration', () => {
    const html = magicLinkTemplate({
      magicLinkUrl: 'https://app.example.com/auth/magic?token=abc123',
      expiresInMinutes: 15,
    });

    expect(html).toContain('https://app.example.com/auth/magic?token=abc123');
  });

  it('encodes & in magicLinkUrl as &amp; in the href attribute and text node', () => {
    const html = magicLinkTemplate({
      magicLinkUrl: 'https://app.example.com/auth/magic?token=t1&email=user%40example.com',
      expiresInMinutes: 15,
    });

    expect(html).not.toContain('token=t1&email=');
    expect(html).toContain('token=t1&amp;email=');
  });
});
