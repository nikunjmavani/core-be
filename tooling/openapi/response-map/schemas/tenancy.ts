/** Tenancy resource schemas. */
// ── Organization ──
export const organizationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    slug: { type: 'string' },
    status: { type: 'string' },
    logo_url: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const organizationExample = {
  id: 'org_k7x9m2pqr4w8n1v3',
  name: 'Acme Corporation',
  slug: 'acme-corporation',
  status: 'ACTIVE',
  logo_url: 'https://cdn.example.com/logos/acme-corp.png',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-10T12:00:00.000Z',
};

// ── Organization Settings ──
export const organizationSettingsSchema = {
  type: 'object',
  properties: {
    organization_id: { type: 'string' },
    is_email_notifications_enabled: { type: 'boolean' },
    security_policy: { type: 'object' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const organizationSettingsExample = {
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  is_email_notifications_enabled: true,
  security_policy: { mfa_required: true, session_timeout_minutes: 30 },
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-10T12:00:00.000Z',
};

// ── Organization API Key ──
export const apiKeySchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organization_id: { type: 'string' },
    name: { type: 'string' },
    key_prefix: { type: 'string' },
    last_used_at: { type: 'string', format: 'date-time', nullable: true },
    expires_at: { type: 'string', format: 'date-time', nullable: true },
    status: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const apiKeyExample = {
  id: 'key_x9k3m7n2p5q8w1r4',
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  name: 'Production API Key',
  key_prefix: 'sk_live_abc1',
  last_used_at: '2026-02-14T07:45:00.000Z',
  expires_at: '2027-02-14T00:00:00.000Z',
  status: 'ACTIVE',
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-10T14:20:00.000Z',
};

export const apiKeyCreatedExample = {
  ...apiKeyExample,
  key: 'sk_live_abc123def456ghi789jkl012mno345pqr678',
};

// ── Organization Notification Policy ──
export const notificationPolicySchema = {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    organization_id: { type: 'string' },
    notification_type: { type: 'string' },
    channel: { type: 'string' },
    default_enabled: { type: 'boolean' },
    is_mandatory: { type: 'boolean' },
    muted_until: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const notificationPolicyExample = {
  id: 1,
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  notification_type: 'subscription.updated',
  channel: 'email',
  default_enabled: true,
  is_mandatory: false,
  muted_until: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-02-10T12:00:00.000Z',
};

// ── Membership ──
export const membershipSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    user_id: { type: 'string' },
    organization_id: { type: 'string' },
    role_id: { type: 'string' },
    status: { type: 'string' },
    joined_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const membershipExample = {
  id: 'mbr_q8w3n7p2m5k1r4t6',
  user_id: 'usr_k7x9m2pqr4w8n1v3',
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  role_id: 'rol_m3n7p2q8w5k1r4t6',
  status: 'ACTIVE',
  joined_at: '2026-01-15T10:30:00.000Z',
  created_at: '2026-01-15T10:30:00.000Z',
  updated_at: '2026-02-10T14:20:00.000Z',
};

// ── Member Invitation ──
export const invitationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    membership_id: { type: 'string' },
    email: { type: 'string', format: 'email' },
    expires_at: { type: 'string', format: 'date-time' },
    accepted_at: { type: 'string', format: 'date-time', nullable: true },
    revoked_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const invitationExample = {
  id: 'inv_r4t6m3n7p2q8w5k1',
  membership_id: 'mbr_q8w3n7p2m5k1r4t6',
  email: 'jane.smith@example.com',
  expires_at: '2026-02-21T10:30:00.000Z',
  accepted_at: null,
  revoked_at: null,
  created_at: '2026-02-14T10:30:00.000Z',
};

// ── Member Role ──
export const memberRoleSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    is_system: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const memberRoleExample = {
  id: 'rol_m3n7p2q8w5k1r4t6',
  name: 'Admin',
  description: 'Full access to all organization resources',
  is_system: true,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

// ── Member Role Permission ──
export const memberRolePermissionSchema = {
  type: 'object',
  properties: {
    role_id: { type: 'string' },
    permission_code: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const memberRolePermissionExamples = [
  {
    role_id: 'rol_m3n7p2q8w5k1r4t6',
    permission_code: 'ORGANIZATION_READ',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    role_id: 'rol_m3n7p2q8w5k1r4t6',
    permission_code: 'MEMBERSHIP_READ',
    created_at: '2026-01-01T00:00:00.000Z',
  },
  {
    role_id: 'rol_m3n7p2q8w5k1r4t6',
    permission_code: 'ROLE_READ',
    created_at: '2026-01-01T00:00:00.000Z',
  },
];

// ── Permission ──
export const permissionSchema = {
  type: 'object',
  properties: {
    code: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    category: { type: 'string' },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const permissionExample = {
  code: 'ORGANIZATION_READ',
  name: 'Read Organization',
  description: 'View organization details and settings',
  category: 'organization',
  created_at: '2026-01-01T00:00:00.000Z',
};
