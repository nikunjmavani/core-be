import { pgRole, pgSchema } from 'drizzle-orm/pg-core';

/**
 * Shared Postgres schema definitions.
 * All domain schema files import their pgSchema from here to prevent circular imports
 * when schemas reference tables across domains.
 */

/** Drizzle handle for the Postgres `auth` schema — magic-link tokens, sessions, MFA, mail outbox. */
export const authSchema = pgSchema('auth');
/** Drizzle handle for the Postgres `tenancy` schema — organizations, memberships, roles, API keys. */
export const tenancySchema = pgSchema('tenancy');
/** Drizzle handle for the Postgres `billing` schema — plans, subscriptions, Stripe webhook ledger. */
export const billingSchema = pgSchema('billing');
/** Drizzle handle for the Postgres `notify` schema — notifications, webhooks, delivery attempts. */
export const notifySchema = pgSchema('notify');
/** Drizzle handle for the Postgres `audit` schema — append-only audit log (partitioned by month). */
export const auditSchema = pgSchema('audit');
/** Drizzle handle for the Postgres `upload` schema — S3 upload metadata + tombstone retention. */
export const uploadSchema = pgSchema('upload');

/**
 * Drizzle reference to the unprivileged application role used by RLS policies.
 * Migrations and tests `SET LOCAL ROLE core_be_app` to assert tenant isolation
 * against the same role the runtime uses.
 */
export const coreBeAppRole = pgRole('core_be_app');
