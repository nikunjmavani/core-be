import { baseTemplate } from './base.template.js';

/** Template variables for {@link invitationTemplate} — inviter, target org, accept URL, and TTL. */
export interface InvitationTemplateData {
  inviterName: string;
  organizationName: string;
  acceptUrl: string;
  expiresInDays: number;
}

/**
 * Renders the member-invitation HTML email (wrapped in `baseTemplate`). Emitted
 * from `member-invitation.events` handlers; the `acceptUrl` must already include
 * the signed invitation token so the recipient can complete acceptance.
 */
export function invitationTemplate(data: InvitationTemplateData): string {
  return baseTemplate({
    title: `You're invited to join ${data.organizationName}`,
    preheader: `${data.inviterName} invited you to join ${data.organizationName}.`,
    body: `
      <h1>You've been invited</h1>
      <p><strong>${data.inviterName}</strong> has invited you to join <strong>${data.organizationName}</strong>.</p>
      <p>Click the button below to accept the invitation. This link expires in ${data.expiresInDays} days.</p>
      <p style="text-align: center; margin: 32px 0;">
        <a href="${data.acceptUrl}" class="button">Accept Invitation</a>
      </p>
      <p style="font-size: 13px; color: #6b7280;">If you weren't expecting this invitation, you can safely ignore this email.</p>
      <p style="font-size: 13px; color: #6b7280;">Or copy and paste this URL into your browser:</p>
      <p style="font-size: 12px; color: #9ca3af; word-break: break-all;">${data.acceptUrl}</p>
    `,
  });
}
