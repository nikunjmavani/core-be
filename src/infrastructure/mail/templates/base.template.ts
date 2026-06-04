import { escapeHtml } from './escape-html.util.js';

/**
 * Shared HTML email layout wrapper.
 * Provides consistent styling and branding across all transactional emails.
 *
 * @remarks
 * `title`, `preheader`, and `footerText` are HTML-escaped inside this wrapper
 * so callers may pass raw user/tenant strings without double-encoding. `body`
 * is treated as trusted HTML composed by the caller — any user/tenant values
 * interpolated into `body` must still be escaped at the caller site (see
 * `escapeHtml` and `invitationTemplate` for the established pattern).
 *
 * Audit reference: 2026-06-03 finding #13 (close the implicit escaping contract).
 */
export function baseTemplate(options: {
  title: string;
  preheader?: string;
  body: string;
  footerText?: string;
}): string {
  const { title, preheader, body, footerText } = options;

  const safeTitle = escapeHtml(title);
  const safePreheader = preheader !== undefined ? escapeHtml(preheader) : undefined;
  const safeFooterText =
    footerText !== undefined
      ? escapeHtml(footerText)
      : 'This is an automated message. Please do not reply.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <style>
    body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif; background-color: #f4f4f7; }
    .container { max-width: 570px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #ffffff; border-radius: 8px; padding: 40px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08); }
    .button { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 14px; }
    .footer { text-align: center; padding: 20px; color: #9ca3af; font-size: 12px; }
    h1 { margin: 0 0 16px; font-size: 22px; color: #111827; }
    p { margin: 0 0 16px; color: #374151; font-size: 15px; line-height: 1.6; }
    .preheader { display: none !important; visibility: hidden; mso-hide: all; font-size: 1px; line-height: 1px; max-height: 0; max-width: 0; opacity: 0; overflow: hidden; }
  </style>
</head>
<body>
  ${safePreheader ? `<span class="preheader">${safePreheader}</span>` : ''}
  <div class="container">
    <div class="card">
      ${body}
    </div>
    <div class="footer">
      ${safeFooterText}
    </div>
  </div>
</body>
</html>`;
}
