import type { PermissionOutput } from './permission.types.js';

/**
 * Shapes a `permissions` catalog row into the HTTP response form, converting
 * the timestamp to ISO-8601. The catalog has no public id — `code` is the
 * external identifier.
 */
export function serializePermission(row: {
  code: string;
  name: string;
  description: string | null;
  category: string;
  created_at: Date;
}): PermissionOutput {
  return {
    code: row.code,
    name: row.name,
    description: row.description,
    category: row.category,
    created_at: row.created_at.toISOString(),
  };
}
