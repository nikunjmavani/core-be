import { pgRole, pgSchema } from 'drizzle-orm/pg-core';

/**
 * Shared Postgres schema definitions.
 * All domain schema files import their pgSchema from here to prevent circular imports
 * when schemas reference tables across domains.
 */

export const authSchema = pgSchema('auth');
export const tenancySchema = pgSchema('tenancy');
export const billingSchema = pgSchema('billing');
export const notifySchema = pgSchema('notify');
export const auditSchema = pgSchema('audit');
export const uploadSchema = pgSchema('upload');

export const coreBeAppRole = pgRole('core_be_app');
