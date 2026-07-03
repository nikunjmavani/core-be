import { describe, it, expect } from 'vitest';
import { verificationCodeTemplate } from '@/infrastructure/mail/templates/verification-code.template.js';
import { invitationTemplate } from '@/infrastructure/mail/templates/invitation.template.js';

describe('mail templates (snapshots)', () => {
  it('verificationCodeTemplate matches snapshot', () => {
    const html = verificationCodeTemplate({
      code: 'AB2CD3',
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
