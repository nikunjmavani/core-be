import { bigserial, bigint, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';

/**
 * Dedicated MFA methods table — conceptually separate from login auth_methods.
 * Stores TOTP secrets, backup codes, and other MFA factor data.
 */
export const mfa_methods = authSchema.table('mfa_methods', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  public_id: varchar('public_id', { length: 21 }).notNull().unique(),
  user_id: bigint('user_id', { mode: 'number' }).notNull(),
  method_type: varchar('method_type', { length: 20 }).notNull(), // TOTP, SMS, EMAIL, BACKUP_CODES
  encrypted_secret: text('encrypted_secret'),
  phone_number: varchar('phone_number', { length: 20 }),
  is_verified: boolean('is_verified').notNull().default(false),
  is_primary: boolean('is_primary').notNull().default(false),
  last_used_at: timestamp('last_used_at', { withTimezone: true }),
  verified_at: timestamp('verified_at', { withTimezone: true }),
  revoked_at: timestamp('revoked_at', { withTimezone: true }),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  created_by_user_id: bigint('created_by_user_id', { mode: 'number' }),
});
