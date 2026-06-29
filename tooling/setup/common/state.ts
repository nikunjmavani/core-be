import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import * as logger from './logger.js';
import { SetupError } from './setup-error.js';

const neonBranchStateSchema = z.object({
  branchId: z.string(),
  endpointId: z.string(),
  databaseUrl: z.string(),
  databaseMigrationUrl: z.string().optional(),
  serviceRoleName: z.string().optional(),
  /**
   * Password for the SQL-managed runtime role (see `ensureRuntimeRoleViaSql` in
   * `setup-neon.provider.ts`). Persisted so re-runs reuse the same connection string
   * across env files, GitHub Environments, and Railway. Absent for state written
   * by the legacy REST-API role flow — its absence is the signal to re-run the
   * Neon step and create the new `<env>_app_login` role.
   */
  serviceRolePassword: z.string().optional(),
});

const redisDatabaseStateSchema = z.object({
  databaseId: z.union([z.string(), z.number()]),
  publicEndpoint: z.string(),
  redisUrl: z.string(),
});

const s3BucketStateSchema = z.object({
  name: z.string(),
  region: z.string(),
});

const iamUserStateSchema = z.object({
  username: z.string(),
  arn: z.string(),
  accessKeyId: z.string(),
  secretAccessKey: z.string(),
});

const railwayCustomDomainStateSchema = z.object({
  domain: z.string(),
  customDomainId: z.string(),
  targetPort: z.number().int().positive().optional(),
  verified: z.boolean().optional(),
  certificateStatus: z.string().optional(),
  attachedAt: z.string(),
});

const railwayServiceStateSchema = z.object({
  serviceId: z.string(),
  environmentId: z.string().optional(),
  url: z.string().optional(),
  customDomain: railwayCustomDomainStateSchema.optional(),
});

const jwtSecretStateSchema = z.union([
  z.string(),
  z.object({
    jwtSecret: z.string(),
    jwtPrivateKey: z.string().optional(),
    jwtPublicKey: z.string().optional(),
    jwtSigningKid: z.string().optional(),
    secretsEncryptionKey: z.string().optional(),
  }),
]);

const railwayEnvironmentStateSchema = z.object({
  environmentId: z.string(),
  services: z.record(z.string(), railwayServiceStateSchema),
});

export const setupStateSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  neon: z
    .object({
      projectId: z.string(),
      branches: z.record(z.string(), neonBranchStateSchema),
    })
    .optional(),
  redis: z
    .object({
      subscriptionId: z.number(),
      databases: z.record(z.string(), redisDatabaseStateSchema),
    })
    .optional(),
  aws: z
    .object({
      buckets: z.record(z.string(), s3BucketStateSchema),
      iamUsers: z.record(z.string(), iamUserStateSchema),
    })
    .optional(),
  sentry: z
    .object({
      projectSlug: z.string(),
      dsn: z.string(),
    })
    .optional(),
  posthog: z
    .object({
      /** Resolved project API key (`phc_…`) — public by design, emitted as POSTHOG_KEY. */
      projectApiKey: z.string(),
      /** Ingestion host emitted as POSTHOG_HOST (US or EU cloud). */
      host: z.string(),
    })
    .optional(),
  jwt: z.record(z.string(), jwtSecretStateSchema).optional(),
  railway: z
    .object({
      version: z.number().optional(),
      projectId: z.string(),
      services: z.record(z.string(), railwayServiceStateSchema),
      environments: z.record(z.string(), railwayEnvironmentStateSchema).optional(),
      /**
       * Per-environment Railway project token, minted by the Railway provider via
       * `projectTokenCreate` when `secrets.railway.apiToken` (RAILWAY_API_TOKEN) is set.
       * Persisted so re-runs reuse the same token, and so `exportEnvFiles` can write
       * `RAILWAY_TOKEN=<env-scoped value>` to each `.env.<env>`. Absent when only the
       * single-token fallback (`RAILWAY_TOKEN`) is configured — in that mode every env
       * gets the same token, which only works for the single environment that token is
       * scoped to.
       */
      environmentTokens: z.record(z.string(), z.string()).optional(),
    })
    .optional(),
  github: z
    .object({
      repository: z.string(),
      secrets: z.array(z.string()),
    })
    .optional(),
  postman: z
    .object({
      collectionId: z.string().optional(),
    })
    .optional(),
  scalar: z
    .object({
      namespace: z.string().optional(),
      slug: z.string().optional(),
      version: z.string().optional(),
      registryUrl: z.string().optional(),
    })
    .optional(),
});

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');
// State lives in the gitignored `.setup/` directory (alongside `.setup/.setup-credentials`),
// out of the app's `.env.<environment>` namespace.
const SETUP_DIR = resolve(PROJECT_ROOT, '.setup');
const STATE_PATH = resolve(SETUP_DIR, '.setup-state.json');

export function createEmptyState(): z.infer<typeof setupStateSchema> {
  const now = new Date().toISOString();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function loadState(): z.infer<typeof setupStateSchema> {
  if (!existsSync(STATE_PATH)) {
    return createEmptyState();
  }

  const raw = readFileSync(STATE_PATH, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.warn('Corrupted .setup-state.json — starting fresh.');
    return createEmptyState();
  }

  const result = setupStateSchema.safeParse(parsed);
  if (!result.success) {
    logger.warn('Invalid .setup-state.json schema — starting fresh.');
    return createEmptyState();
  }

  return result.data;
}

const STATE_BAK_PATH = `${STATE_PATH}.bak`;
const STATE_TMP_PATH = `${STATE_PATH}.tmp`;
const STATE_LOCK_PATH = `${STATE_PATH}.lock`;

export function saveState(state: z.infer<typeof setupStateSchema>): void {
  state.updatedAt = new Date().toISOString();
  // Atomic write: backup the prior file, write to a temp path, then rename over the
  // target so a crash mid-write can never leave a half-written state file.
  // `.setup-state.json` is gitignored, blocked by the pre-commit secret-file guard, and
  // unreadable by the agent (deny-read guard); values flow only into `.env.<environment>`.
  mkdirSync(SETUP_DIR, { recursive: true });
  if (existsSync(STATE_PATH)) copyFileSync(STATE_PATH, STATE_BAK_PATH);
  writeFileSync(STATE_TMP_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  renameSync(STATE_TMP_PATH, STATE_PATH);
}

/**
 * Acquire an advisory lock for an apply run so two concurrent `setup:infra` runs can't
 * clobber the state. Human-only tooling, so a stale lock is surfaced for manual removal
 * rather than auto-broken. Returns a `release()` to call in a `finally`.
 */
export function acquireStateLock(): () => void {
  mkdirSync(SETUP_DIR, { recursive: true });
  try {
    closeSync(openSync(STATE_LOCK_PATH, 'wx')); // O_EXCL — fails if it already exists
  } catch {
    throw new SetupError(`Another setup run holds the lock (${STATE_LOCK_PATH}).`, {
      hint: `If no other run is active, delete it: rm ${STATE_LOCK_PATH}`,
    });
  }
  return () => {
    try {
      if (existsSync(STATE_LOCK_PATH)) unlinkSync(STATE_LOCK_PATH);
    } catch {
      // best-effort release
    }
  };
}

export function stateFileExists(): boolean {
  return existsSync(STATE_PATH);
}

export function clearState(): void {
  if (existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, `${JSON.stringify(createEmptyState(), null, 2)}\n`, 'utf-8');
  }
}
