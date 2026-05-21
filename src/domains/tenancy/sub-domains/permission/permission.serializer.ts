import type { PermissionOutput } from './permission.types.js';

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
