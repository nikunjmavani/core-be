import { describe, it, expect } from 'vitest';
import { magicLinkTemplate } from '@/infrastructure/mail/templates/magic-link.template.js';
import { invitationTemplate } from '@/infrastructure/mail/templates/invitation.template.js';

describe('mail templates (snapshots)', () => {
  it('magicLinkTemplate matches snapshot', () => {
    const html = magicLinkTemplate({
      code: '123456',
      expiresInMinutes: 15,
    });
    expect(html).toMatchSnapshot();
  });

  it('invitationTemplate matches snapshot', () => {
    const html = invitationTemplate({
      organizationName: 'Acme Corp',
      inviterName: 'Jane Doe',
      acceptUrl: 'https://app.example.com/invite/abc',
      expiresInDays: 7,
    });
    expect(html).toMatchSnapshot();
  });
});
