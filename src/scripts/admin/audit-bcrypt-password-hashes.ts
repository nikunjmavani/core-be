/**
 * Counts auth.users rows with legacy bcrypt password hashes.
 * Exit 0 when count is zero (safe to remove bcrypt dependency); exit 1 otherwise.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... pnpm tool:bcrypt-audit
 */
import 'dotenv/config';
import { sql } from '@/infrastructure/database/connection.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

const BCRYPT_HASH_PATTERN = String.raw`^\$2[aby]\$`;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logger.error('DATABASE_URL is required');
    process.exit(1);
  }

  if (process.env.NODE_ENV === 'production') {
    logger.error('Refusing to run bcrypt audit against NODE_ENV=production');
    process.exit(1);
  }

  const rows = await sql<{ bcrypt_users: string }[]>`
    SELECT COUNT(*)::text AS bcrypt_users
    FROM auth.users
    WHERE password_hash ~ ${BCRYPT_HASH_PATTERN}
  `;

  const bcryptUserCount = Number(rows[0]?.bcrypt_users ?? '0');
  logger.info({ bcryptUserCount }, 'bcrypt.password_hash.audit');

  if (bcryptUserCount > 0) {
    logger.warn(
      { bcryptUserCount },
      'bcrypt.password_hash.audit: legacy hashes remain — keep bcrypt for verify/rehash',
    );
    process.exit(1);
  }

  logger.info('bcrypt.password_hash.audit: no legacy bcrypt hashes found');
  process.exit(0);
}

main().catch((error: unknown) => {
  logger.error({ error }, 'bcrypt.password_hash.audit.failed');
  process.exit(1);
});
