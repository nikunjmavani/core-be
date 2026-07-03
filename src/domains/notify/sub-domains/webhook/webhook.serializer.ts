/**
 * Webhook row fields exposed to API consumers. Mirrors the live Drizzle row but with
 * the public-id rename baked in and every leak-class field excluded — see sec-T finding
 * #17 (bigserial leakage) and the existing sec-N hardening (`encrypted_secret`,
 * `encrypted_secret_previous` are signing material and must never appear).
 */
/** Timestamp column as it arrives from Drizzle (`Date`) or after a JSON round-trip (`string`). */
type SerializableTimestamp = Date | string;
/** Nullable {@link SerializableTimestamp} for optional / not-yet-set timestamp columns. */
type NullableSerializableTimestamp = SerializableTimestamp | null;

interface WebhookRow {
  public_id: string;
  url: string;
  events: unknown;
  is_enabled: boolean;
  secret_rotated_at: NullableSerializableTimestamp;
  created_at: SerializableTimestamp;
  updated_at: SerializableTimestamp;
}

function toIsoString(value: NullableSerializableTimestamp | undefined): string | null {
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
 * Row shape returned by the trimmed listByWebhook projection (sec-r4-D6).
 * `payload` and `response_body` are intentionally absent — the list response
 * never exposes them. A dedicated single-attempt detail endpoint can expose
 * them later when actually needed.
 */
interface WebhookDeliveryAttemptListRow {
  event_type: string;
  event_key: string | null;
  status: string;
  http_status_code: number | null;
  sent_at: NullableSerializableTimestamp;
  attempt_count: number;
  next_retry_at: NullableSerializableTimestamp;
  created_at: SerializableTimestamp;
}

function serializeDeliveryAttemptListItem<T extends WebhookDeliveryAttemptListRow>(row: T) {
  return {
    event_type: row.event_type,
    event_key: row.event_key,
    status: row.status,
    http_status_code: row.http_status_code,
    sent_at: toIsoString(row.sent_at),
    attempt_count: row.attempt_count,
    next_retry_at: toIsoString(row.next_retry_at),
    created_at: toIsoString(row.created_at),
  };
}

/**
 * Strip-only response serializer for `notify.webhook_delivery_attempts` rows that drops
 * the internal bigserial `id` and `webhook_id` from the API response (sec-T finding #17).
 *
 * sec-r4-D6: `many` is the list-row shape and excludes `payload` + `response_body`.
 */
export const WebhookDeliveryAttemptSerializer = {
  many(rows: readonly WebhookDeliveryAttemptListRow[]) {
    return rows.map((row) => serializeDeliveryAttemptListItem(row));
  },
};
