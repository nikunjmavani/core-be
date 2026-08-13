import { describe, expect, test } from 'vitest';
import { sendEmail } from '@/infrastructure/mail/mail.service.js';
import { PROJECT_SLUG } from '@/shared/constants/project-identity.constants.js';
import {
  hasResendLiveCredentials,
  liveEmailRecipient,
  describeSkipReason,
} from './helpers/live-credentials.js';

/**
 * Live Resend contract — sends one real email through the same `sendEmail` wrapper the
 * application uses, and asserts Resend still returns a message id.
 *
 * Requires an explicit `CONTRACT_LIVE_EMAIL_TO`, because unlike the other providers this one
 * has an irreversible side effect: mail actually leaves. Point it at a throwaway inbox.
 */
describe.skipIf(!hasResendLiveCredentials())('Resend LIVE contract', () => {
  test('sendEmail delivers to Resend and returns a message id', async () => {
    const messageId = await sendEmail({
      to: liveEmailRecipient(),
      subject: `${PROJECT_SLUG} live contract check ${new Date().toISOString()}`,
      html: '<p>Automated live contract check. Safe to delete.</p>',
      text: 'Automated live contract check. Safe to delete.',
      tags: [{ name: 'source', value: `${PROJECT_SLUG}-live-contract` }],
    });

    expect(typeof messageId).toBe('string');
    expect(messageId.length).toBeGreaterThan(0);
  });

  test('sendEmail surfaces a ResendApiError for an invalid recipient', async () => {
    // Contract check on the *error* path: Resend must still reject a malformed address rather
    // than silently accepting it, which is what the offline tier asserts against a fixture.
    await expect(
      sendEmail({
        to: 'not-an-email-address',
        subject: `${PROJECT_SLUG} live contract negative check`,
        html: '<p>should not send</p>',
      }),
    ).rejects.toThrow();
  });
});

describe.skipIf(hasResendLiveCredentials())('Resend LIVE contract — skipped', () => {
  test('reports why it did not run', () => {
    expect(describeSkipReason('resend')).toContain('resend');
  });
});
