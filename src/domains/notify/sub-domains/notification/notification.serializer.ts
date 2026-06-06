/**
 * Notification row fields exposed to API consumers. Mirrors the live Drizzle row but with
 * the public-id rename baked in and every leak-class field excluded — see sec-T finding #17.
 */
interface NotificationRow {
  public_id: string;
  type: string;
  title: string;
  message: string;
  data: unknown;
  action_url: string | null;
  action_label: string | null;
  is_read: boolean;
  read_at: Date | string | null;
  created_at: Date | string;
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeOne<T extends NotificationRow>(row: T) {
  return {
    // sec-T #17: emit the 21-char public_id, NOT the internal bigserial. The
    // bigserial `id` (a global sequence shared across tenants — leaks platform
    // notification volume), `user_id` (internal user enumeration key), and
    // `organization_id` are all DROPPED. The notification routes are `/me`-
    // scoped (the user is identified by `auth.userId`); the recipient never
    // needs to be echoed back in the payload.
    id: row.public_id,
    type: row.type,
    title: row.title,
    message: row.message,
    data: row.data,
    action_url: row.action_url,
    action_label: row.action_label,
    is_read: row.is_read,
    read_at: toIsoString(row.read_at),
    created_at: toIsoString(row.created_at),
  };
}

/**
 * Strip-only response serializer for `notify.notifications` rows that drops every
 * internal bigserial (id, user_id, organization_id) before reaching the client
 * (sec-T finding #17 — replaces the prior identity passthrough).
 */
export const NotificationSerializer = {
  one(row: NotificationRow) {
    return serializeOne(row);
  },
  many(rows: readonly NotificationRow[]) {
    return rows.map((row) => serializeOne(row));
  },
};
