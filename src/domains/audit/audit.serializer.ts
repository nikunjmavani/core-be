/**
 * Metadata keys whose values are internal numeric surrogate ids today
 * (sec-U2). Stripped from the admin audit-list response so internal bigints
 * never leak through arbitrary event payloads. Add new keys here when a
 * writer persists another raw internal id under a fresh name.
 *
 * Public-id keys (`session_public_id`, `role_public_id`, etc.) are
 * intentionally NOT on this list — admins need them to pivot from an audit
 * row to the resource it touched, and public ids are already returned via
 * the row's top-level columns.
 */
const SENSITIVE_INTERNAL_METADATA_KEYS = new Set<string>(['auth_method_id', 'mfa_method_id']);

function sanitizeMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }

  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(
      ([key]) => !SENSITIVE_INTERNAL_METADATA_KEYS.has(key),
    ),
  );
}

/**
 * Response serializer for audit log rows. Removes only known internal-id
 * keys from the `metadata` JSON before exposing rows over the admin API.
 *
 * @remarks
 * sec-U2: the old implementation stripped every `*_id` key (blacklist),
 * which incidentally erased the public ids writers persist
 * (`session_public_id`, `role_public_id`) — leaving forensics blind. The
 * denylist {@link SENSITIVE_INTERNAL_METADATA_KEYS} is forward-safe: a future
 * writer that stores a raw internal numeric id is added to the set.
 */
export const AuditSerializer = {
  many<T extends { metadata?: unknown }>(items: T[]): T[] {
    return items.map((item) => ({
      ...item,
      metadata: sanitizeMetadata(item.metadata),
    }));
  },
};
