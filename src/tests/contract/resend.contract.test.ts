import { sendEmail } from '@/infrastructure/mail/mail.service.js';
import { ResendApiError } from '@/infrastructure/mail/resend-api.error.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import nock from 'nock';
import { describe, expect, test, vi, afterEach } from 'vitest';

import outboundResendEmailsRequestExpectedEnvelope from './fixtures/resend/emails.send.request.expected.json' with { type: 'json' };
import outboundResendEmailsErrorEnvelope from './fixtures/resend/emails.send.error.response.json' with { type: 'json' };
import outboundResendEmailsSuccessEnvelope from './fixtures/resend/emails.send.success.response.json' with { type: 'json' };
import { registerThirdPartyContractTestIsolationHooks } from './helpers/register-contract-test-hooks.js';
import {
  ResendEmailsSuccessfulResponseContractSchema,
  ResendEmailsOutgoingJsonContractSchema,
  ResendEmailsErrorEnvelopeContractSchema,
} from './schemas/resend.schemas.js';

registerThirdPartyContractTestIsolationHooks();

function coerceOutboundResendRequestBodyUtf8Outbound(rawOutboundBodyUnknown: unknown): string {
  if (typeof rawOutboundBodyUnknown === 'string') return rawOutboundBodyUnknown;
  if (Buffer.isBuffer(rawOutboundBodyUnknown)) {
    return rawOutboundBodyUnknown.toString('utf8');
  }
  if (
    rawOutboundBodyUnknown !== null &&
    typeof rawOutboundBodyUnknown === 'object' &&
    !Array.isArray(rawOutboundBodyUnknown)
  ) {
    return JSON.stringify(rawOutboundBodyUnknown);
  }
  return String(rawOutboundBodyUnknown ?? '');
}

describe('Resend outbound email contract (`mail.service.sendEmail`)', () => {
  const resendApiHostnameOutbound = 'https://api.resend.com';
  let outboundLoggerFixtureErrorSpy: ReturnType<typeof vi.spyOn> | undefined;

  afterEach(() => {
    outboundLoggerFixtureErrorSpy?.mockRestore();
  });

  test('sendEmail emits JSON payloads that match documented Resend request fields', async () => {
    nock(resendApiHostnameOutbound)
      .post('/emails', (rawOutboundUtf8PayloadUnknown) => {
        const parsedResendEmailsOutboundJsonEnvelope = JSON.parse(
          coerceOutboundResendRequestBodyUtf8Outbound(rawOutboundUtf8PayloadUnknown),
        );
        ResendEmailsOutgoingJsonContractSchema.parse(parsedResendEmailsOutboundJsonEnvelope);
        const outboundResendFromHeaderExpectedEnvelope = `${env.EMAIL_FROM_NAME ?? 'Core'} <${env.EMAIL_FROM_ADDRESS ?? 'noreply@albetrios.com'}>`;
        expect(parsedResendEmailsOutboundJsonEnvelope).toMatchObject({
          from: outboundResendFromHeaderExpectedEnvelope,
          to: outboundResendEmailsRequestExpectedEnvelope.to,
          subject: outboundResendEmailsRequestExpectedEnvelope.subject,
          html: outboundResendEmailsRequestExpectedEnvelope.html,
        });
        return true;
      })
      .matchHeader('authorization', /^Bearer /)
      .reply(200, outboundResendEmailsSuccessEnvelope);

    const outboundResendMessageIdentifier = await sendEmail({
      to: outboundResendEmailsRequestExpectedEnvelope.to[0] ?? '',
      subject: outboundResendEmailsRequestExpectedEnvelope.subject,
      html: outboundResendEmailsRequestExpectedEnvelope.html,
    });

    ResendEmailsSuccessfulResponseContractSchema.parse(outboundResendEmailsSuccessEnvelope);
    expect(outboundResendMessageIdentifier).toBe(outboundResendEmailsSuccessEnvelope.id);
  });

  test('sendEmail throws ResendApiError while logging Resend semantic error payloads', async () => {
    nock(resendApiHostnameOutbound)
      .post('/emails', () => true)
      .matchHeader('authorization', /^Bearer /)
      .reply(422, outboundResendEmailsErrorEnvelope);

    outboundLoggerFixtureErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    await expect(
      sendEmail({
        to: outboundResendEmailsRequestExpectedEnvelope.to[0] ?? '',
        subject: outboundResendEmailsRequestExpectedEnvelope.subject,
        html: outboundResendEmailsRequestExpectedEnvelope.html,
      }),
    ).rejects.toBeInstanceOf(ResendApiError);

    ResendEmailsErrorEnvelopeContractSchema.parse(outboundResendEmailsErrorEnvelope);
    expect(outboundLoggerFixtureErrorSpy).toHaveBeenCalled();
  });
});
