/**
 * Webhook row fields exposed to API consumers. Mirrors the live Drizzle row but with
 * the public-id rename baked in and every leak-class field excluded — see sec-T finding
 * #17 (bigserial leakage) and the existing sec-N hardening (`encrypted_secret`,
 * `encrypted_secret_previous` are signing material and must never appear).
 */
interface WebhookRow {
  public_id: string;
  url: string;
  events: unknown;
  is_enabled: boolean;
  secret_rotated_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeOne<T extends WebhookRow>(row: T) {
  return {
    // sec-T #17: emit the 21-char public_id, NOT the internal bigserial. The
    // bigserial `id`, `organization_id`, `created_by_user_id`, and
    // `updated_by_user_id` are all DROPPED — they leak platform webhook volume
    // and tenant id correlation. The `encrypted_secret` / `encrypted_secret_previous`
    // signing material was never written here even before sec-T #17, but the
    // typed allowlist makes the absence load-bearing instead of incidental.
    id: row.public_id,
    url: row.url,
    events: row.events,
    is_enabled: row.is_enabled,
    // sec-N8: surface `secret_rotated_at` so operators can verify rotation
    // landed without exposing the secret material itself.
    secret_rotated_at: toIsoString(row.secret_rotated_at),
    created_at: toIsoString(row.created_at),
    updated_at: toIsoString(row.updated_at),
  };
}

/**
 * Strip-only response serializer for `notify.webhooks` rows that drops every internal
 * bigserial AND every secret-bearing field before reaching the client (sec-T finding
 * #17 — replaces the prior deny-list passthrough that emitted bigserials).
 */
export const WebhookSerializer = {
  one(row: WebhookRow) {
    return serializeOne(row);
  },
  many(rows: readonly WebhookRow[]) {
    return rows.map((row) => serializeOne(row));
  },
};

/**
 * Delivery-attempt row fields exposed to API consumers. The audit-trail table has no
 * `public_id` column (append-only; rows are addressed only via list, not by id), so
 * the bigserial `id` and the bigint `webhook_id` are dropped from the response — both
 * would leak platform delivery volume and webhook enumeration otherwise.
 */
interface WebhookDeliveryAttemptRow {
  event_type: string;
  event_key: string | null;
  payload: unknown;
  status: string;
  http_status_code: number | null;
  response_body: string | null;
  sent_at: Date | string | null;
  attempt_count: number;
  next_retry_at: Date | string | null;
  created_at: Date | string;
}

function serializeDeliveryAttempt<T extends WebhookDeliveryAttemptRow>(row: T) {
  return {
    event_type: row.event_type,
    event_key: row.event_key,
    payload: row.payload,
    status: row.status,
    http_status_code: row.http_status_code,
    response_body: row.response_body,
    sent_at: toIsoString(row.sent_at),
    attempt_count: row.attempt_count,
    next_retry_at: toIsoString(row.next_retry_at),
    created_at: toIsoString(row.created_at),
  };
}

/**
 * Strip-only response serializer for `notify.webhook_delivery_attempts` rows that drops
 * the internal bigserial `id` and `webhook_id` from the API response (sec-T finding #17).
 */
export const WebhookDeliveryAttemptSerializer = {
  one(row: WebhookDeliveryAttemptRow) {
    return serializeDeliveryAttempt(row);
  },
  many(rows: readonly WebhookDeliveryAttemptRow[]) {
    return rows.map((row) => serializeDeliveryAttempt(row));
  },
};
