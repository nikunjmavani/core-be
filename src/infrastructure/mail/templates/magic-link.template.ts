import { baseTemplate } from './base.template.js';

/** Template variables for {@link magicLinkTemplate} — signed sign-in URL and its TTL in minutes. */
export interface MagicLinkTemplateData {
  magicLinkUrl: string;
  expiresInMinutes: number;
}

/**
 * Renders the passwordless magic-link HTML email (wrapped in `baseTemplate`).
 * Emitted from `auth-method.magic-link` event handlers when a sign-in is requested.
 */
export function magicLinkTemplate(data: MagicLinkTemplateData): string {
  return baseTemplate({
    title: 'Sign in to your account',
    preheader: `Click the link below to sign in — expires in ${data.expiresInMinutes} minutes.`,
    body: `
      <h1>Sign in to your account</h1>
      <p>Click the button below to securely sign in. This link expires in ${data.expiresInMinutes} minutes.</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${data.magicLinkUrl}" class="button">Sign In</a>
      </p>
      <p style="font-size: 13px; color: #6b7280;">If you didn't request this, you can safely ignore this email.</p>
      <p style="font-size: 13px; color: #6b7280;">Or copy and paste this URL into your browser:</p>
      <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">${data.magicLinkUrl}</p>
    `,
  });
}
