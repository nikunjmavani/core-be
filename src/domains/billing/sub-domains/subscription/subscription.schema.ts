import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  varchar,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  check,
  pgPolicy,
} from 'drizzle-orm/pg-core';
import { billingSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { plans } from '@/domains/billing/sub-domains/plan/plan.schema.js';

export const subscriptions = billingSchema
  .table(
    'subscriptions',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      public_id: varchar('public_id', { length: 21 }).notNull(),
      organization_id: bigint('organization_id', { mode: 'number' })
        .notNull()
        .references(() => organizations.id, { onDelete: 'cascade' }),
      plan_id: bigint('plan_id', { mode: 'number' })
        .notNull()
        .references(() => plans.id, { onDelete: 'restrict' }),
      provider: varchar('provider', { length: 50 }),
      provider_subscription_id: varchar('provider_subscription_id', { length: 255 }),
      provider_customer_id: varchar('provider_customer_id', { length: 255 }),
      billing_cycle: varchar('billing_cycle', { length: 20 }).notNull(),
      status: varchar('status', { length: 20 }).notNull().default('TRIALING'),
      current_period_start: timestamp('current_period_start', { withTimezone: true }).notNull(),
      current_period_end: timestamp('current_period_end', { withTimezone: true }).notNull(),
      trial_end: timestamp('trial_end', { withTimezone: true }),
      cancel_at_period_end: boolean('cancel_at_period_end').notNull().default(false),
      canceled_at: timestamp('canceled_at', { withTimezone: true }),
      last_stripe_event_created_at: timestamp('last_stripe_event_created_at', {
        withTimezone: true,
      }),
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
      uniqueIndex('idx_subscriptions_public_id').on(table.public_id),
      uniqueIndex('idx_subscriptions_org').on(table.organization_id),
      index('idx_subscriptions_org_status').on(table.organization_id, table.status),
      index('idx_subscriptions_plan').on(table.plan_id),
      index('idx_subscriptions_status_period').on(table.status, table.current_period_end),
      index('idx_subscriptions_provider_subscription_id')
        .on(table.provider_subscription_id)
        .where(sql`${table.provider_subscription_id} IS NOT NULL`),
      check(
        'chk_subs_status',
        sql`${table.status} IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'PAUSED')`,
      ),
      check('chk_subs_cycle', sql`${table.billing_cycle} IN ('MONTHLY', 'YEARLY')`),
      check('chk_subs_period', sql`${table.current_period_end} > ${table.current_period_start}`),
      check('chk_subs_updated', sql`${table.updated_at} >= ${table.created_at}`),
      pgPolicy('subscriptions_tenant_isolation', {
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
