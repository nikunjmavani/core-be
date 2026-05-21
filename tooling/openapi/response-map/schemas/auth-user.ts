/** Auth and user resource schemas. */
// ── User ──
export const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    is_email_verified: { type: 'boolean' },
    is_mfa_enabled: { type: 'boolean' },
    first_name: { type: 'string', nullable: true },
    last_name: { type: 'string', nullable: true },
    avatar_url: { type: 'string', nullable: true },
    status: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const userExample = {
  id: 'usr_k7x9m2pqr4w8n1v3',
  email: 'john.doe@example.com',
  is_email_verified: true,
  is_mfa_enabled: false,
  first_name: 'John',
  last_name: 'Doe',
  avatar_url: 'https://cdn.example.com/avatars/john-doe.jpg',
  status: 'ACTIVE',
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-10T14:20:00.000Z',
};

// ── User Settings ──
export const userSettingsSchema = {
  type: 'object',
  properties: {
    user_id: { type: 'string' },
    is_dark_mode_enabled: { type: 'boolean' },
    is_notifications_enabled: { type: 'boolean' },
    language: { type: 'string' },
    preferred_locales: { type: 'array', items: { type: 'string' } },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const userSettingsExample = {
  user_id: 'usr_k7x9m2pqr4w8n1v3',
  is_dark_mode_enabled: false,
  is_notifications_enabled: true,
  language: 'en',
  preferred_locales: ['en', 'es'],
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-10T14:20:00.000Z',
};

// ── Notification Preference ──
export const notificationPreferenceSchema = {
  type: 'object',
  properties: {
    notification_type: { type: 'string' },
    channel: { type: 'string' },
    organization_id: { type: 'string', nullable: true },
    is_enabled: { type: 'boolean' },
  },
};

export const notificationPreferenceExamples = [
  {
    notification_type: 'subscription.updated',
    channel: 'email',
    organization_id: null,
    is_enabled: true,
  },
  {
    notification_type: 'member.invited',
    channel: 'push',
    organization_id: 'org_k7x9m2pqr4w8n1v3',
    is_enabled: false,
  },
];

// ── Access Token ──
export const accessTokenSchema = {
  type: 'object',
  properties: {
    access_token: { type: 'string' },
    refresh_token: { type: 'string' },
    expires_in: { type: 'integer' },
    token_type: { type: 'string' },
  },
};

export const accessTokenExample = {
  access_token:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidXNyX2s3eDltMnBxcjR3OG4xdjMiLCJpYXQiOjE3Mzk1MjAwMDAsImV4cCI6MTczOTUyMzYwMH0.abc123',
  refresh_token:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoidXNyX2s3eDltMnBxcjR3OG4xdjMiLCJ0eXBlIjoicmVmcmVzaCJ9.xyz789',
  expires_in: 3600,
  token_type: 'Bearer',
};

// ── Magic Link Sent ──
export const magicLinkSentSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
    expires_in_minutes: { type: 'integer' },
  },
};

export const magicLinkSentExample = {
  message: 'Magic link sent to your email address',
  expires_in_minutes: 15,
};

// ── Message ──
export const messageSchema = {
  type: 'object',
  properties: {
    message: { type: 'string' },
  },
};

// ── MFA Enroll ──
export const mfaEnrollSchema = {
  type: 'object',
  properties: {
    secret: { type: 'string' },
    provisioning_uri: { type: 'string' },
    method_id: { type: 'integer' },
  },
};

export const mfaEnrollExample = {
  secret: 'JBSWY3DPEHPK3PXP',
  provisioning_uri:
    'otpauth://totp/core-be:john.doe%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=core-be',
  method_id: 1,
};

// ── MFA Verified ──
export const mfaVerifiedSchema = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
  },
};

// ── OAuth Providers ──
export const oauthProvidersSchema = {
  type: 'object',
  properties: {
    providers: { type: 'array', items: { type: 'string' } },
  },
};

// ── Auth Method ──
export const authMethodSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    method_type: { type: 'string' },
    provider: { type: 'string', nullable: true },
    is_primary: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const authMethodExample = {
  id: 1,
  method_type: 'password',
  provider: null,
  is_primary: true,
  created_at: '2026-01-15T10:30:00.000Z',
};

// ── Session ──
export const sessionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    ip_address: { type: 'string' },
    user_agent: { type: 'string' },
    last_active_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
    is_current: { type: 'boolean' },
  },
};

export const sessionExample = {
  id: 'ses_m7n2p5q8w1r4x9k3',
  ip_address: '203.0.113.42',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  last_active_at: '2026-02-14T08:30:00.000Z',
  created_at: '2026-02-10T10:00:00.000Z',
  is_current: true,
};

// ── MFA Method ──
export const mfaMethodSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    method_type: { type: 'string' },
    is_verified: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const mfaMethodExample = {
  id: 'mfa_t6m3n7p2q8w5k1r4',
  method_type: 'MFA_TOTP',
  is_verified: true,
  created_at: '2026-01-20T09:00:00.000Z',
};
