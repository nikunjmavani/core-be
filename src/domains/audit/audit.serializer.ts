function sanitizeMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return metadata;
  }

  return Object.fromEntries(
    Object.entries(metadata as Record<string, unknown>).filter(([key]) => !key.endsWith('_id')),
  );
}

export const AuditSerializer = {
  many<T extends { metadata?: unknown }>(items: T[]): T[] {
    return items.map((item) => ({
      ...item,
      metadata: sanitizeMetadata(item.metadata),
    }));
  },
};
