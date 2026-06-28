import { describe, expect, it } from 'vitest';
import { verificationCodeTemplate } from '@/infrastructure/mail/templates/verification-code.template.js';

describe('verificationCodeTemplate', () => {
  it('renders the sign-in code and its TTL', () => {
    const html = verificationCodeTemplate({ code: 'AB2CD3', expiresInMinutes: 15 });

    expect(html).toContain('AB2CD3');
    expect(html).toContain('15 minutes');
  });

  it('HTML-escapes the code value as defence-in-depth', () => {
    const html = verificationCodeTemplate({ code: '<b>42</b>', expiresInMinutes: 15 });

    expect(html).not.toContain('<b>42</b>');
    expect(html).toContain('&lt;b&gt;42&lt;/b&gt;');
  });
});
