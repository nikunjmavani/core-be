import { baseTemplate } from '@/infrastructure/mail/templates/base.template.js';
import { escapeHtml } from '@/shared/utils/text/html-escape.util.js';

/**
 * Render a notification row into the shared transactional email template, HTML-escaping every
 * untrusted field (title, message, optional action URL) so the worker can safely hand the
 * resulting `subject` + `html` pair to the mail outbox.
 */
export function buildNotificationEmailHtml(notification: {
  title: string;
  message: string;
  actionUrl?: string | null;
}): { subject: string; html: string } {
  const safeTitle = escapeHtml(notification.title);
  const safeMessage = escapeHtml(notification.message);
  const safeActionUrl = notification.actionUrl ? escapeHtml(notification.actionUrl) : undefined;

  const html = baseTemplate({
    title: safeTitle,
    preheader: safeMessage,
    body: `
                <h1>${safeTitle}</h1>
                <p>${safeMessage}</p>
                ${safeActionUrl ? `<p style="text-align: center; margin: 32px 0;"><a href="${safeActionUrl}" class="button">View Details</a></p>` : ''}
              `,
  });

  return { subject: safeTitle, html };
}
