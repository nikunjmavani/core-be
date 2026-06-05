import { describe, expect, it } from 'vitest';
import { invitationTemplate } from '@/infrastructure/mail/templates/invitation.template.js';

describe('invitationTemplate HTML escaping', () => {
  const baseData = {
    acceptUrl: 'https://app.example.com/invitations/abc/accept?token=signed',
    expiresInDays: 7,
  };

  it('escapes a script-tag injection in the inviter name', () => {
    const html = invitationTemplate({
      ...baseData,
      inviterName: '<script>alert(1)</script>',
      organizationName: 'Acme',
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes markup and quotes in the organization name', () => {
    const html = invitationTemplate({
      ...baseData,
      inviterName: 'Alice',
      organizationName: '"><a href="https://evil.test">Acme</a>',
    });

    expect(html).not.toContain('<a href="https://evil.test">');
    expect(html).toContain('&quot;&gt;&lt;a href=&quot;https://evil.test&quot;&gt;');
  });

  it('renders ordinary names without altering safe text', () => {
    const html = invitationTemplate({
      ...baseData,
      inviterName: 'Alice Smith',
      organizationName: 'Acme Corporation',
    });

    expect(html).toContain('<strong>Alice Smith</strong>');
    expect(html).toContain('<strong>Acme Corporation</strong>');
  });

  it('encodes & in acceptUrl as &amp; in the href attribute and text node', () => {
    const html = invitationTemplate({
      inviterName: 'Alice',
      organizationName: 'Acme',
      acceptUrl: 'https://app.example.com/invite/abc?token=t1&ref=email',
      expiresInDays: 7,
    });

    expect(html).not.toContain('?token=t1&ref=email');
    expect(html).toContain('?token=t1&amp;ref=email');
  });
});
