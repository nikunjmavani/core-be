/**
 * Re-encrypt field secrets (MFA TOTP, webhook signing keys) with the current SECRETS_ENCRYPTION_KEY.
 *
 * Usage:
 *   pnpm tool:rotate-field-secrets --dry-run
 *   SECRETS_ENCRYPTION_KEY=<new-hex> ROTATE_FROM_SECRETS_KEY=<old-hex> pnpm tool:rotate-field-secrets
 */
import '@/shared/config/load-env-files.js';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { eq, isNotNull } from 'drizzle-orm';
import { database, sql, closeDatabase } from '@/infrastructure/database/connection.js';
import { mfa_methods } from '@/domains/auth/sub-domains/auth-mfa/auth-mfa-method.schema.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';
import {
  decryptFieldSecret,
  encryptFieldSecret,
} from '@/shared/utils/security/field-secret-encryption.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const VERSION_PREFIX = 'v1:';

function parseHexKey(raw: string, label: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
    throw new Error(`${label} must be 64 hex characters (32 bytes)`);
  }
  return Buffer.from(raw, 'hex');
}

function decryptWithKey(stored: string, key: Buffer): string {
  if (!stored.startsWith(VERSION_PREFIX)) {
    return stored;
  }
  const data = Buffer.from(stored.slice(VERSION_PREFIX.length), 'base64');
  const iv = data.subarray(0, IV_LENGTH);
  const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, encrypted]);
  return `${VERSION_PREFIX}${payload.toString('base64')}`;
}

async function reencryptValue(
  stored: string | null,
  targetKey: Buffer | null,
  fromKey: Buffer | null,
): Promise<{ next: string | null; changed: boolean }> {
  if (stored === null || stored.length === 0) {
    return { next: stored, changed: false };
  }

  const plaintext = fromKey ? decryptWithKey(stored, fromKey) : decryptFieldSecret(stored);
  const next = targetKey ? encryptWithKey(plaintext, targetKey) : encryptFieldSecret(plaintext);
  return { next, changed: next !== stored };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      'dry-run': { type: 'boolean', default: false },
      'from-key': { type: 'string' },
    },
  });

  const dryRun = values['dry-run'] ?? false;
  const fromKeyHex = values['from-key'] ?? process.env.ROTATE_FROM_SECRETS_KEY;
  const fromKey = fromKeyHex ? parseHexKey(fromKeyHex, 'ROTATE_FROM_SECRETS_KEY') : null;
  const targetKeyHex = process.env.SECRETS_ENCRYPTION_KEY;
  const targetKey = targetKeyHex ? parseHexKey(targetKeyHex, 'SECRETS_ENCRYPTION_KEY') : null;

  await sql`select 1`;

  let mfaUpdated = 0;
  let webhookUpdated = 0;

  const mfaRows = await database
    .select({ id: mfa_methods.id, encrypted_secret: mfa_methods.encrypted_secret })
    .from(mfa_methods)
    .where(isNotNull(mfa_methods.encrypted_secret));

  for (const row of mfaRows) {
    const { next, changed } = await reencryptValue(row.encrypted_secret, targetKey, fromKey);
    if (!changed || next === null) continue;
    mfaUpdated += 1;
    if (!dryRun) {
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
    const { next, changed } = await reencryptValue(row.encrypted_secret, targetKey, fromKey);
    if (!changed || next === null) continue;
    webhookUpdated += 1;
    if (!dryRun) {
      await database
        .update(webhooks)
        .set({ encrypted_secret: next })
        .where(eq(webhooks.id, row.id));
    }
  }

  logger.info(
    { dryRun, mfaUpdated, webhookUpdated, usedLegacyFromKey: Boolean(fromKey) },
    'rotate-field-secrets.complete',
  );

  await closeDatabase();
}

main().catch((error) => {
  logger.error({ error }, 'rotate-field-secrets.failed');
  process.exitCode = 1;
});
