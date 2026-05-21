/** OpenAPI route metadata — health, MCP, and auth. */
import type { RouteMetadata } from './types.js';

export const healthMcpAuthMetadata: Record<string, RouteMetadata> = {
  // ── Health ──
  'GET /health/live': {
    summary: 'Liveness check',
    description:
      'Returns 200 if the server process is alive. Used by orchestrators for basic health monitoring.',
    tags: ['Health'],
  },
  'GET /health/ready': {
    summary: 'Readiness check',
    description:
      'Returns 200 when Postgres, Redis (cache), and BullMQ (representative notification queue Redis client) respond within timeouts. Parallel probes — returns 503 with per-dependency unavailable flags if any probe fails.',
    tags: ['Health'],
  },

  // ── MCP (Model Context Protocol) ──
  'GET /api/v1/mcp': {
    summary: 'MCP streamable HTTP (GET)',
    description:
      'Model Context Protocol endpoint when `ENABLE_MCP_SERVER=true`. Exposes resources `core-be://openapi` and `core-be://routes`, plus the `call_api` tool for in-process API invocation. Requires JWT with global `admin` or `super_admin` role. See docs/integrations/cursor-backend-mcp.md.',
    tags: ['MCP'],
  },
  'POST /api/v1/mcp': {
    summary: 'MCP streamable HTTP (POST)',
    description:
      'Primary MCP transport for Cursor and other MCP clients. Same auth and capabilities as GET. Request and response bodies follow the MCP streamable HTTP specification.',
    tags: ['MCP'],
  },

  // ── Auth ──
  'POST /api/v1/auth/login': {
    summary: 'Login with email and password',
    description:
      'Authenticates a user with email and password credentials. Returns access and refresh tokens on success. If MFA is enabled, returns a challenge requiring a second factor.',
    tags: ['Auth'],
  },
  'POST /api/v1/auth/logout': {
    summary: 'Logout current session',
    description:
      'Invalidates the current session and refresh token. Requires a valid bearer token.',
    tags: ['Auth'],
  },
  'POST /api/v1/auth/magic-link/send': {
    summary: 'Send magic link email',
    description:
      'Sends a passwordless login link to the provided email address. The link expires after a short period.',
    tags: ['Auth', 'Magic Link'],
  },
  'POST /api/v1/auth/magic-link/verify': {
    summary: 'Verify magic link token',
    description: 'Validates the magic link token and returns access and refresh tokens on success.',
    tags: ['Auth', 'Magic Link'],
  },
  'GET /api/v1/auth/oauth/providers': {
    summary: 'List available OAuth providers',
    description:
      'Returns a list of configured OAuth providers (e.g. Google, GitHub) available for login.',
    tags: ['Auth', 'OAuth'],
  },
  'GET /api/v1/auth/oauth/{provider}': {
    summary: 'Initiate OAuth flow',
    description:
      'Redirects the user to the OAuth provider authorization page to begin the login flow.',
    tags: ['Auth', 'OAuth'],
  },
  'GET /api/v1/auth/oauth/{provider}/callback': {
    summary: 'OAuth callback',
    description:
      'Handles the OAuth provider callback after user authorization. Exchanges the code for tokens and creates or links the user account.',
    tags: ['Auth', 'OAuth'],
  },
  'POST /api/v1/auth/password/forgot': {
    summary: 'Request password reset',
    description:
      'Sends a password reset email to the user. Returns 200 even if the email is not registered (to prevent enumeration).',
    tags: ['Auth', 'Password'],
  },
  'POST /api/v1/auth/password/reset': {
    summary: 'Reset password with token',
    description: 'Resets the user password using a valid reset token received via email.',
    tags: ['Auth', 'Password'],
  },
  'POST /api/v1/auth/password/change': {
    summary: 'Change current password',
    description:
      "Changes the authenticated user's password. Requires the current password for verification.",
    tags: ['Auth', 'Password'],
  },
  'POST /api/v1/auth/email/verify': {
    summary: 'Verify email address',
    description:
      "Confirms the user's email address using a verification token sent during registration.",
    tags: ['Auth', 'Email Verification'],
  },
  'POST /api/v1/auth/email/resend-verification': {
    summary: 'Resend email verification',
    description: 'Resends the email verification link to the currently authenticated user.',
    tags: ['Auth', 'Email Verification'],
  },
  'POST /api/v1/auth/mfa/enroll': {
    summary: 'Enroll in MFA',
    description:
      'Begins multi-factor authentication enrollment. Returns a TOTP secret and QR code URI for authenticator app setup.',
    tags: ['Auth', 'MFA'],
  },
  'POST /api/v1/auth/mfa/verify': {
    summary: 'Verify MFA code',
    description:
      'Validates a TOTP code to complete MFA verification during login or enrollment confirmation.',
    tags: ['Auth', 'MFA'],
  },
  'POST /api/v1/auth/mfa/challenge': {
    summary: 'Issue MFA challenge',
    description:
      'Issues a new MFA challenge for a user during the login flow. The user must respond with a valid TOTP code.',
    tags: ['Auth', 'MFA'],
  },
  'GET /api/v1/auth/mfa': {
    summary: 'List enrolled MFA methods',
    description: 'Returns all MFA methods enrolled by the authenticated user.',
    tags: ['Auth', 'MFA'],
  },
  'DELETE /api/v1/auth/mfa/{mfaMethodId}': {
    summary: 'Remove MFA method',
    description:
      'Deletes an enrolled MFA method. Cannot remove the last MFA method if MFA is required by organization policy.',
    tags: ['Auth', 'MFA'],
  },
  'POST /api/v1/auth/refresh': {
    summary: 'Refresh access token',
    description:
      'Exchanges a valid session cookie for a new short-lived access token. The session_id httpOnly cookie is sent automatically by the browser. When ALLOWED_ORIGINS is set, requests that include an Origin header must match that allowlist (403 otherwise); requests without Origin are allowed for non-browser clients.',
    tags: ['Auth', 'Token'],
  },

  // ── Auth: Sessions ──
  'GET /api/v1/auth/me/sessions': {
    summary: 'List my active sessions',
    description:
      'Returns all active sessions for the authenticated user, including device and location info.',
    tags: ['Auth', 'Session'],
  },
  'DELETE /api/v1/auth/me/sessions': {
    summary: 'Revoke all sessions',
    description: 'Revokes all active sessions for the authenticated user except the current one.',
    tags: ['Auth', 'Session'],
  },
  'DELETE /api/v1/auth/me/sessions/{id}': {
    summary: 'Revoke a specific session',
    description:
      'Revokes a specific session by its ID. Cannot revoke the current session (use logout instead).',
    tags: ['Auth', 'Session'],
  },

  // ── Auth: Auth Methods ──
  'GET /api/v1/auth/me/auth-methods': {
    summary: 'List my auth methods',
    description:
      'Returns all authentication methods (password, OAuth, magic link) linked to the authenticated user.',
    tags: ['Auth', 'Auth Method'],
  },
  'POST /api/v1/auth/me/auth-methods': {
    summary: 'Add auth method',
    description:
      "Links a new authentication method (e.g. OAuth provider) to the authenticated user's account.",
    tags: ['Auth', 'Auth Method'],
  },
  'DELETE /api/v1/auth/me/auth-methods/{id}': {
    summary: 'Remove auth method',
    description:
      "Removes an authentication method from the user's account. Cannot remove the last auth method.",
    tags: ['Auth', 'Auth Method'],
  },
};
