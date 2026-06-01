/**
 * Public HTTP response shape for a single permission catalog entry. `code` is
 * the stable external identifier (e.g. `membership:manage`); `category` groups
 * codes by domain for UI rendering; `created_at` is ISO-8601.
 */
export interface PermissionOutput {
  code: string;
  name: string;
  description: string | null;
  category: string;
  created_at: string;
}
