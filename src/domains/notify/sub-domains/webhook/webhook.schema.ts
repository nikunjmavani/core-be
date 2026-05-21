import {
  bigint,
  bigserial,
  varchar,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { notifySchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';

export const webhooks = notifySchema
  .table(
    'webhooks',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      public_id: varchar('public_id', { length: 21 }).notNull(),
      organization_id: bigint('organization_id', { mode: 'number' })
        .notNull()
        .references(() => organizations.id, { onDelete: 'cascade' }),
      url: text('url').notNull(),
      encrypted_secret: varchar('encrypted_secret', { length: 255 }).notNull(),
      events: jsonb('events').notNull(),
      is_enabled: boolean('is_enabled').notNull().default(true),
      deleted_at: timestamp('deleted_at', { withTimezone: true }),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      created_by_user_id: bigint('created_by_user_id', { mode: 'number' }).references(
        () => users.id,
      ),
      updated_by_user_id: bigint('updated_by_user_id', { mode: 'number' }).references(
        () => users.id,
      ),
    },
    (table) => [
      uniqueIndex('idx_webhooks_public_id').on(table.public_id),
      index('idx_webhooks_org_enabled').on(table.organization_id, table.is_enabled),
      uniqueIndex('idx_webhooks_organization_id_url_unique').on(table.organization_id, table.url),
      check('chk_webhooks_url', sql`${table.url} ~ '^https://'`),
      check('chk_webhooks_updated', sql`${table.updated_at} >= ${table.created_at}`),
      pgPolicy('webhooks_tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`${table.organization_id} = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true'`,
      }),
    ],
  )
  .enableRLS();

export const webhook_delivery_attempts = notifySchema
  .table(
    'webhook_delivery_attempts',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      webhook_id: bigint('webhook_id', { mode: 'number' })
        .notNull()
        .references(() => webhooks.id, { onDelete: 'cascade' }),
      event_type: varchar('event_type', { length: 50 }).notNull(),
      event_key: varchar('event_key', { length: 255 }),
      payload: jsonb('payload').notNull(),
      status: varchar('status', { length: 20 }).notNull().default('PENDING'),
      http_status_code: integer('http_status_code'),
      response_body: text('response_body'),
      sent_at: timestamp('sent_at', { withTimezone: true }),
      attempt_count: integer('attempt_count').notNull().default(0),
      next_retry_at: timestamp('next_retry_at', { withTimezone: true }),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index('idx_webhook_attempts_webhook').on(
        table.webhook_id,
        table.event_type,
        table.created_at,
      ),
      index('idx_webhook_attempts_retry').on(table.status, table.next_retry_at),
      uniqueIndex('idx_webhook_delivery_attempts_pending_event_key')
        .on(table.webhook_id, table.event_key)
        .where(sql`${table.status} = 'PENDING' AND ${table.event_key} IS NOT NULL`),
      check(
        'chk_webhook_attempts_status',
        sql`${table.status} IN ('PENDING', 'SENDING', 'SENT', 'FAILED')`,
      ),
      check(
        'chk_webhook_attempts_count',
        sql`${table.attempt_count} >= 0 AND ${table.attempt_count} <= 5`,
      ),
      pgPolicy('webhook_delivery_attempts_tenant_isolation', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`${table.webhook_id} IN (
            SELECT id FROM notify.webhooks
            WHERE organization_id = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true'`,
      }),
    ],
  )
  .enableRLS();
