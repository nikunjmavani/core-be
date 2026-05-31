import { varchar, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tenancySchema } from '@/infrastructure/database/pg-schemas.js';

/**
 * `tenancy.permissions` catalog table — global, organization-agnostic list of
 * permission codes. `code` is the primary key (e.g. `membership:manage`) so
 * `role_permissions` can reference it directly; no RLS policy, since the
 * catalog is identical for every tenant.
 */
export const permissions = tenancySchema.table(
  'permissions',
  {
    code: varchar('code', { length: 100 }).primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    description: text('description'),
    category: varchar('category', { length: 50 }).notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_permissions_category').on(table.category),
    index('idx_permissions_name').on(table.name),
  ],
);
