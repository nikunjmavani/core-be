import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import * as logger from './logger.js';

const neonBranchStateSchema = z.object({
  branchId: z.string(),
  endpointId: z.string(),
  databaseUrl: z.string(),
  databaseMigrationUrl: z.string().optional(),
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

const railwayServiceStateSchema = z.object({
  serviceId: z.string(),
  environmentId: z.string().optional(),
  url: z.string().optional(),
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
  jwt: z.record(z.string(), jwtSecretStateSchema).optional(),
  railway: z
    .object({
      version: z.number().optional(),
      projectId: z.string(),
      services: z.record(z.string(), railwayServiceStateSchema),
      environments: z.record(z.string(), railwayEnvironmentStateSchema).optional(),
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
});

const STATE_PATH = resolve(import.meta.dirname, '../../../.setup-state.json');

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

export function saveState(state: z.infer<typeof setupStateSchema>): void {
  state.updatedAt = new Date().toISOString();
  writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

export function stateFileExists(): boolean {
  return existsSync(STATE_PATH);
}

export function clearState(): void {
  if (existsSync(STATE_PATH)) {
    writeFileSync(STATE_PATH, `${JSON.stringify(createEmptyState(), null, 2)}\n`, 'utf-8');
  }
}
