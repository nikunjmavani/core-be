import { baseTemplate } from './base.template.js';
import { escapeHtml } from './escape-html.util.js';

/** Template variables for {@link verificationCodeTemplate} — the alphanumeric passwordless sign-in code and its TTL in minutes. */
export interface VerificationCodeTemplateData {
  code: string;
  expiresInMinutes: number;
}

/**
 * Renders the passwordless email verification-code HTML email (wrapped in `baseTemplate`).
 * Emitted from the auth-method event handlers when a sign-in code is requested.
 *
 * @remarks
 * The sign-in code is a server-generated alphanumeric code, but it is still passed through
 * {@link escapeHtml} as defence-in-depth in case the code source ever changes. The code is displayed
 * for the user to type into the login form — it is delivered as a one-time code (never a clickable
 * link), and its guess-resistance comes from the large keyspace + short TTL + single-use consume +
 * per-user attempt cap.
 */
export function verificationCodeTemplate(data: VerificationCodeTemplateData): string {
  const code = escapeHtml(data.code);

  return baseTemplate({
    title: 'Sign in to your account',
    preheader: `Your sign-in code is ${code} — expires in ${data.expiresInMinutes} minutes.`,
    body: `
      <h1>Sign in to your account</h1>
      <p>Enter the code below to securely sign in. This code expires in ${data.expiresInMinutes} minutes.</p>
      <p style="text-align: center; margin: 32px 0;">
        <span style="display: inline-block; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #111827;">${code}</span>
      </p>
      <p style="font-size: 13px; color: #6b7280;">If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}
