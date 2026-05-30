/**
 * Runbook-as-code: re-encrypt field secrets onto the current SECRETS_ENCRYPTION key version
 * (pnpm ops:secrets:rotate).
 *
 * Walks every encrypted field-secret column (MFA TOTP seeds, webhook signing keys), decrypts each
 * value using the key for its OWN stored version prefix, and re-encrypts it with
 * `SECRETS_ENCRYPTION_CURRENT_VERSION`. Pair with a `SECRETS_ENCRYPTION_KEYS` keyring that holds
 * both the old and new versions so decryption of in-place rows keeps working during the cutover.
 *
 * DRY-RUN SAFE: the default never mutates anything. It reports how many rows would change. Pass
 * `--apply` to write the re-encrypted values back.
 *
 * Usage:
 *   pnpm ops:secrets:rotate                 # report-only (dry-run)
 *   pnpm ops:secrets:rotate --apply         # re-encrypt rows to the current version (mutates)
 *
 * Rotation procedure (zero downtime):
 *   1. Generate a new 64-hex key (e.g. `openssl rand -hex 32`).
 *   2. Set SECRETS_ENCRYPTION_KEYS to a JSON map containing both versions, e.g.
 *      {"v1":"<old-hex>","v2":"<new-hex>"} (v1 may also stay in SECRETS_ENCRYPTION_KEY).
 *   3. Deploy with SECRETS_ENCRYPTION_CURRENT_VERSION=v2 so new writes use v2 while v1 rows
 *      still decrypt via the keyring.
 *   4. Run `pnpm ops:secrets:rotate --apply` to migrate existing v1 rows to v2.
 *   5. Once no v1 rows remain, drop v1 from SECRETS_ENCRYPTION_KEYS (and SECRETS_ENCRYPTION_KEY).
 */
import '@/shared/config/load-env-files.js';
import { parseArgs } from 'node:util';
import { eq, isNotNull } from 'drizzle-orm';
import { database, sql, closeDatabase } from '@/infrastructure/database/connection.js';
import { mfa_methods } from '@/domains/auth/sub-domains/auth-mfa/mfa-method.schema.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import { getEnv } from '@/shared/config/env.config.js';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

interface RotateOptions {
  apply: boolean;
}

function parseOptions(): RotateOptions {
  const { values } = parseArgs({
    options: {
      apply: { type: 'boolean', default: false },
    },
  });
  return { apply: values.apply === true };
}

/** Current write-version prefix (e.g. `v1:`) that fully-migrated rows already carry. */
function currentVersionPrefix(): string {
  return `${getEnv().SECRETS_ENCRYPTION_CURRENT_VERSION}:`;
}

/**
 * Re-encrypts one stored value onto the current version. Returns the rewritten value plus a
 * `changed` flag; rows already at the current version are left byte-for-byte untouched.
 */
function reencryptToCurrentVersion({
  stored,
  currentPrefix,
}: {
  stored: string | null;
  currentPrefix: string;
}): { next: string | null; changed: boolean } {
  if (stored === null || stored.length === 0) {
    return { next: stored, changed: false };
  }
  if (stored.startsWith(currentPrefix)) {
    return { next: stored, changed: false };
  }
  const next = encryptFieldSecret(decryptFieldSecret(stored));
  return { next, changed: next !== stored };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const currentPrefix = currentVersionPrefix();

  await sql`select 1`;

  let mfaUpdated = 0;
  let webhookUpdated = 0;

  const mfaRows = await database
    .select({ id: mfa_methods.id, encrypted_secret: mfa_methods.encrypted_secret })
    .from(mfa_methods)
    .where(isNotNull(mfa_methods.encrypted_secret));

  for (const row of mfaRows) {
    const { next, changed } = reencryptToCurrentVersion({
      stored: row.encrypted_secret,
      currentPrefix,
    });
    if (!changed || next === null) {
      continue;
    }
    mfaUpdated += 1;
    if (options.apply) {
      await database
        .update(mfa_methods)
        .set({ encrypted_secret: next })
        .where(eq(mfa_methods.id, row.id));
    }
  }

  const webhookRows = await database
    .select({ id: webhooks.id, encrypted_secret: webhooks.encrypted_secret })
    .from(webhooks);

  for (const row of webhookRows) {
    const { next, changed } = reencryptToCurrentVersion({
      stored: row.encrypted_secret,
      currentPrefix,
    });
    if (!changed || next === null) {
      continue;
    }
    webhookUpdated += 1;
    if (options.apply) {
      await database
        .update(webhooks)
        .set({ encrypted_secret: next })
        .where(eq(webhooks.id, row.id));
    }
  }

  logger.info(
    {
      apply: options.apply,
      currentVersion: getEnv().SECRETS_ENCRYPTION_CURRENT_VERSION,
      mfaUpdated,
      webhookUpdated,
    },
    options.apply ? 'secrets-key-rotate.complete' : 'secrets-key-rotate.dry-run',
  );

  await closeDatabase();
}

main().catch((error) => {
  logger.error({ error }, 'secrets-key-rotate.failed');
  process.exitCode = 1;
});
