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
    status: {
      type: 'string',
      enum: ['ACTIVE', 'LOCKED', 'SUSPENDED'],
      description: 'Possible values: ACTIVE | LOCKED | SUSPENDED',
      example: 'ACTIVE',
    },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const userExample = {
  id: 'usr_k7x9m2pqr4w8n1v3a1b2c',
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
  user_id: 'usr_k7x9m2pqr4w8n1v3a1b2c',
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
    channel: {
      type: 'string',
      enum: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
      description: 'Possible values: EMAIL | SMS | PUSH | IN_APP',
      example: 'EMAIL',
    },
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
    organization_id: 'org_k7x9m2pqr4w8n1v3a1b2c',
    is_enabled: false,
  },
];

// ── Access Token ──
export const accessTokenSchema = {
  type: 'object',
  properties: {
    access_token: {
      type: 'string',
      description: 'JWT to send as `Authorization: Bearer <ACCESS_TOKEN>`',
    },
    session_id: {
      type: 'string',
      pattern: '^ses_[a-z0-9]{21}$',
      description:
        'ID of the session this token belongs to (revocable via DELETE /auth/me/sessions/{session_id})',
    },
  },
};

export const accessTokenExample = {
  access_token:
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c3Jfazd4OW0ycHFyNHc4bjF2M2EiLCJpYXQiOjE3Mzk1MjAwMDAsImV4cCI6MTczOTUyMzYwMH0.abc123',
  session_id: 'ses_m7n2p5q8w1r4x9k3a1b2c',
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
    id: { type: 'string', pattern: '^am_[a-z0-9]{21}$' },
    method_type: {
      type: 'string',
      enum: ['PASSWORD', 'MAGIC_LINK', 'OAUTH', 'MFA_TOTP', 'MFA_SMS', 'MFA_EMAIL'],
      description:
        'Possible values: PASSWORD | MAGIC_LINK | OAUTH | MFA_TOTP | MFA_SMS | MFA_EMAIL',
      example: 'PASSWORD',
    },
    provider: { type: 'string', nullable: true },
    is_primary: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const authMethodExample = {
  id: 'am_k7x9m2pqr4w8n1v3a5b6c',
  method_type: 'PASSWORD',
  provider: null,
  is_primary: true,
  verified_at: '2026-01-15T10:30:00.000Z',
  last_used_at: '2026-02-14T08:30:00.000Z',
  created_at: '2026-01-15T10:30:00.000Z',
};

// ── Session ──
export const sessionSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^ses_[a-z0-9]{21}$' },
    ip_address: { type: 'string' },
    user_agent: { type: 'string', nullable: true },
    device: {
      type: 'string',
      nullable: true,
      description:
        'Device/OS family parsed from user_agent (e.g. "Mac", "iPhone"); null if unknown.',
    },
    browser: {
      type: 'string',
      nullable: true,
      description:
        'Browser family parsed from user_agent (e.g. "Chrome", "Safari"); null if unknown.',
    },
    is_current: {
      type: 'boolean',
      description: 'True for the session the request is authenticated with.',
    },
    last_active_at: { type: 'string', format: 'date-time' },
    expires_at: { type: 'string', format: 'date-time' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const sessionExample = {
  id: 'ses_m7n2p5q8w1r4x9k3a1b2c',
  ip_address: '203.0.113.42',
  user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  device: 'Mac',
  browser: 'Chrome',
  is_current: true,
  last_active_at: '2026-02-14T08:30:00.000Z',
  expires_at: '2026-02-21T08:30:00.000Z',
  created_at: '2026-02-10T10:00:00.000Z',
};

// ── MFA Method ──
export const mfaMethodSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    method_type: {
      type: 'string',
      enum: ['MFA_TOTP', 'MFA_SMS', 'MFA_EMAIL'],
      description: 'Possible values: MFA_TOTP | MFA_SMS | MFA_EMAIL',
      example: 'MFA_TOTP',
    },
    is_verified: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const mfaMethodExample = {
  id: 'mfa_t6m3n7p2q8w5k1r4a1b2c',
  method_type: 'MFA_TOTP',
  is_verified: true,
  created_at: '2026-01-20T09:00:00.000Z',
};

// ── MFA enrollment confirmation (recovery codes returned once) ──
export const mfaEnrollConfirmSchema = {
  type: 'object',
  properties: {
    recovery_codes: { type: 'array', items: { type: 'string' } },
    mfa_method_id: { type: 'string', pattern: '^am_[a-z0-9]{21}$' },
  },
};

export const mfaEnrollConfirmExample = {
  recovery_codes: ['ABCD-EFGH-IJKL', 'MNOP-QRST-UVWX'],
  mfa_method_id: 'am_t6m3n7p2q8w5k1r4a1b2c',
};

// ── Step-up authentication ──
export const stepUpSchema = {
  type: 'object',
  properties: { stepped_up: { type: 'boolean' } },
};

export const stepUpExample = { stepped_up: true };

// ── WebAuthn (passkeys) ──
/**
 * WebAuthn ceremony options + opaque challenge token. `options` is the W3C
 * `PublicKeyCredentialCreationOptionsJSON` (registration) or `RequestOptionsJSON`
 * (authentication), passed verbatim to `navigator.credentials`; it is intentionally
 * an opaque object (`additionalProperties: true`) rather than re-typed field-by-field.
 */
export const webauthnCeremonyOptionsSchema = {
  type: 'object',
  properties: {
    options: {
      type: 'object',
      additionalProperties: true,
      description: 'W3C WebAuthn options JSON, passed verbatim to navigator.credentials.',
    },
    challenge_token: {
      type: 'string',
      description: 'Opaque challenge token echoed back on the matching verify call.',
    },
  },
};

export const webauthnRegistrationOptionsExample = {
  options: {
    challenge: 'Ik4oIon-oq81WEaTanMl-okW-pDuD02n34lm70GVO_E',
    rp: { name: 'YourApp', id: 'localhost' },
    user: { id: 'dXNyX2V4YW1wbGU', name: 'user@example.com', displayName: 'user@example.com' },
    pubKeyCredParams: [
      { alg: -8, type: 'public-key' },
      { alg: -7, type: 'public-key' },
    ],
    timeout: 60000,
    attestation: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
      requireResidentKey: false,
    },
  },
  challenge_token: 'opaque-registration-challenge-token',
};

export const webauthnAuthenticationOptionsExample = {
  options: {
    rpId: 'localhost',
    challenge: 'R1i538VsjTay-HR5E7BnBTncygO1KRomuA_mVat31KI',
    allowCredentials: [{ id: 'credential-id', transports: ['internal'], type: 'public-key' }],
    timeout: 60000,
    userVerification: 'required',
  },
  challenge_token: 'opaque-authentication-challenge-token',
};

export const webauthnRegisterVerifySchema = {
  type: 'object',
  properties: {
    verified: { type: 'boolean' },
    credential_id: { type: 'string' },
  },
};

export const webauthnRegisterVerifyExample = { verified: true, credential_id: 'credential-id' };

export const webauthnCredentialSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^wac_[a-z0-9]{21}$' },
    device_type: { type: 'string', nullable: true },
    backed_up: { type: 'boolean' },
    transports: { type: 'array', items: { type: 'string' } },
    created_at: { type: 'string', format: 'date-time' },
    last_used_at: { type: 'string', format: 'date-time', nullable: true },
  },
};

export const webauthnCredentialExample = {
  id: 'wac_t6m3n7p2q8w5k1r4a1b2c',
  device_type: 'singleDevice',
  backed_up: false,
  transports: ['internal'],
  created_at: '2026-01-20T09:00:00.000Z',
  last_used_at: '2026-02-14T08:30:00.000Z',
};
