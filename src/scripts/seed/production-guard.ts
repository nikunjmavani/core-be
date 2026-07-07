/**
 * Guard that keeps the bulk seeder from ever writing to a hosted/production database.
 * The orchestrator calls {@link assertBulkSeedAllowed} before any write.
 */

/** Hostnames treated as safe (local Docker / loopback) for bulk seeding. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

/**
 * Throws unless bulk seeding is safe to run. `ALLOW_BULK_SEED=1` is an explicit override.
 * Otherwise `DATABASE_URL` must resolve to a local host (localhost / 127.0.0.1 / ::1) — a remote
 * DSN (production) can never be bulk-seeded without the override, so no `NODE_ENV`
 * comparison is needed.
 *
 * @remarks
 * Failure modes: throws when `DATABASE_URL` is missing or unparseable, or when its host is
 * non-local. Side effects: none (pure check).
 */
export function assertBulkSeedAllowed(env: NodeJS.ProcessEnv): void {
  if (env.ALLOW_BULK_SEED === '1') return;

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('Refusing to bulk-seed: DATABASE_URL is not set.');
  }

  let host: string;
  try {
    host = new URL(databaseUrl).hostname.replace(/(?:^\[)|(?:\]$)/g, '');
  } catch {
    throw new Error('Refusing to bulk-seed: DATABASE_URL is not a valid URL.');
  }

  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to bulk-seed: DATABASE_URL host "${host}" is not local. ` +
        'Set ALLOW_BULK_SEED=1 to override deliberately.',
    );
  }
}
