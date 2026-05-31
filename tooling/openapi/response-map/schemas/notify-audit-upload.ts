/** Notify, audit, and upload resource schemas. */
// ── Notification ──
export const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    user_id: { type: 'string' },
    type: { type: 'string' },
    title: { type: 'string' },
    body: { type: 'string' },
    is_read: { type: 'boolean' },
    read_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const notificationExample = {
  id: 'ntf_m7n2p5q8w1r4x9k3',
  user_id: 'usr_k7x9m2pqr4w8n1v3',
  type: 'subscription.updated',
  title: 'Subscription updated',
  body: 'Your subscription was updated successfully.',
  is_read: false,
  read_at: null,
  created_at: '2026-02-14T10:00:00.000Z',
};

// ── Unread Count ──
export const unreadCountSchema = {
  type: 'object',
  properties: {
    unread_count: { type: 'integer' },
  },
};

// ── Webhook ──
export const webhookSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organization_id: { type: 'string' },
    url: { type: 'string', format: 'uri' },
    events: { type: 'array', items: { type: 'string' } },
    is_enabled: { type: 'boolean' },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
  },
};

export const webhookExample = {
  id: 'whk_p5q8w1r4x9k3m7n2',
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  url: 'https://api.example.com/webhooks/receive',
  events: ['subscription.created', 'subscription.updated', 'member.invited'],
  is_enabled: true,
  created_at: '2026-01-20T09:00:00.000Z',
  updated_at: '2026-02-10T14:20:00.000Z',
};

// ── Webhook Event ──
export const webhookEventSchema = {
  type: 'object',
  properties: {
    event: { type: 'string' },
    description: { type: 'string' },
  },
};

export const webhookEventExamples = [
  { event: 'subscription.created', description: 'Fired when a new subscription is created' },
  { event: 'subscription.updated', description: 'Fired when a subscription is modified' },
  { event: 'member.invited', description: 'Fired when a member invitation is created' },
];

// ── Delivery Attempt ──
export const deliveryAttemptSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    webhook_id: { type: 'string' },
    event_type: { type: 'string' },
    status_code: { type: 'integer', nullable: true },
    response_time_ms: { type: 'integer', nullable: true },
    success: { type: 'boolean' },
    error_message: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const deliveryAttemptExample = {
  id: 'da_w1r4x9k3m7n2p5q8',
  webhook_id: 'whk_p5q8w1r4x9k3m7n2',
  event_type: 'subscription.created',
  status_code: 200,
  response_time_ms: 245,
  success: true,
  error_message: null,
  created_at: '2026-02-14T10:00:00.000Z',
};

// ── Audit Log ──
export const auditLogSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    organization_id: { type: 'string', nullable: true },
    actor_user_id: { type: 'string' },
    resource_type: { type: 'string' },
    resource_id: { type: 'string' },
    action: { type: 'string' },
    metadata: { type: 'object', nullable: true },
    ip_address: { type: 'string', nullable: true },
    user_agent: { type: 'string', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
  },
};

export const auditLogExample = {
  id: 'log_t6m3n7p2q8w5k1r4',
  organization_id: 'org_k7x9m2pqr4w8n1v3',
  actor_user_id: 'usr_k7x9m2pqr4w8n1v3',
  resource_type: 'organization',
  resource_id: 'org_k7x9m2pqr4w8n1v3',
  action: 'organization.updated',
  metadata: { changes: { name: { from: 'Old Name', to: 'Acme Corporation' } } },
  ip_address: '203.0.113.42',
  user_agent: 'Mozilla/5.0',
  created_at: '2026-02-14T10:00:00.000Z',
};

// ── Upload ──
export const uploadSchema = {
  type: 'object',
  properties: {
    uploadUrl: { type: 'string', format: 'uri' },
    key: { type: 'string' },
    expiresAt: { type: 'string', format: 'date-time' },
  },
};

export const uploadExample = {
  uploadUrl: 'https://s3.amazonaws.com/bucket/avatars/usr_abc123.png?X-Amz-Algorithm=...',
  key: 'avatars/usr_k7x9m2pqr4w8n1v3.png',
  expiresAt: '2026-02-14T11:30:00.000Z',
};

// ── Test webhook response ──
export const webhookTestSchema = {
  type: 'object',
  properties: {
    success: { type: 'boolean' },
    status_code: { type: 'integer', nullable: true },
    response_time_ms: { type: 'integer', nullable: true },
    error_message: { type: 'string', nullable: true },
  },
};

export const webhookTestExample = {
  success: true,
  status_code: 200,
  response_time_ms: 180,
  error_message: null,
};
