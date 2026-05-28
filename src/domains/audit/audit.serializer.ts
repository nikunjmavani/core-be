function sanitizeMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }

  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(([key]) => !key.endsWith('_id')),
  );
}

/**
 * Response serializer for audit log rows. Strips any `*_id` keys from the
 * `metadata` JSON before exposing rows over the admin API, so internal
 * surrogate identifiers never leak through arbitrary event payloads.
 */
export const AuditSerializer = {
  many<T extends { metadata?: unknown }>(items: T[]): T[] {
    return items.map((item) => ({
      ...item,
      metadata: sanitizeMetadata(item.metadata),
    }));
  },
};
