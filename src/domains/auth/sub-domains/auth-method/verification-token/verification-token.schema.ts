import { sql } from 'drizzle-orm';
import { bigint, bigserial, varchar, timestamp, index, pgPolicy } from 'drizzle-orm/pg-core';
import { authSchema } from '@/infrastructure/database/pg-schemas.js';
import { users } from '@/domains/user/user.schema.js';

/**
 * Drizzle table for `auth.verification_tokens` — unified store for magic-link /
 * password-reset / email-verification / email-change tokens. `token_hash` is
 * unique and indexed for replay-safe lookups; RLS is enabled with a
 * deliberately permissive `USING (true)` policy. See sec-D9 notes below.
 *
 * @remarks
 * **sec-D9 — application-trust safety model (read this before touching the
 * policy).** The `verification_tokens_application_access` policy grants
 * unrestricted access at the DB layer. The safety model is NOT enforced by
 * RLS — it is enforced by three application-level invariants:
 *
 *   1. The `token_hash` column stores the SHA-256 of a 32-byte CSPRNG random
 *      token. The hash is the secret; possession of it is authorization. An
 *      unconstrained read is harmless unless an attacker reaches the row by
 *      another path (raw SQL access via a compromised role).
 *   2. The application ALWAYS looks up by `token_hash`, never by `user_id` or
 *      `email`. `VerificationTokenRepository.consumeIfValid` is the single
 *      read+UPDATE entry point; there is no scoped-list endpoint.
 *   3. No untrusted SQL execution path exists. Every code path under
 *      `getRequestDatabase()` runs prepared statements through Drizzle.
 *
 * A future operational tool that browses for "all pending magic links" would
 * break invariant #2 and leak `token_hash` + `user_id` + `email`. If such a
 * tool is added, replace the policy with a narrower predicate (e.g.
 * `USING (token_hash = current_setting('app.current_verification_token_hash', true))`
 * set by the consume path) or convert the read to a SECURITY DEFINER resolver.
 * The audit recommendation is to do the latter; we defer that work until the
 * first operational tool actually needs it, because a narrower policy without
 * a corresponding consumer is dead code.
 */
export const verification_tokens = authSchema
  .table(
    'verification_tokens',
    {
      id: bigserial('id', { mode: 'number' }).primaryKey(),
      token_type: varchar('token_type', { length: 30 }).notNull(),
      token_hash: varchar('token_hash', { length: 64 }).notNull().unique(),
      user_id: bigint('user_id', { mode: 'number' })
        .notNull()
        .references(() => users.id),
      email: varchar('email', { length: 255 }).notNull(),
      expires_at: timestamp('expires_at', { withTimezone: true }).notNull(),
      used_at: timestamp('used_at', { withTimezone: true }),
      created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index('idx_verification_tokens_token_hash').on(table.token_hash),
      index('idx_verification_tokens_user_type').on(table.user_id, table.token_type),
      pgPolicy('verification_tokens_application_access', {
        as: 'permissive',
        for: 'all',
        to: 'public',
        using: sql`true`,
        withCheck: sql`true`,
      }),
    ],
  )
  .enableRLS();
