import { z } from 'zod';
import {
  loadSecretsFromEnv,
  envSecretsPath,
  writeEnvSetupTemplateIfMissing,
} from './env-secrets.js';
import type { SetupConfig } from './types.js';

const oauthEnvironmentSchema = z.object({
  clientId: z.string(),
  clientSecret: z.string(),
  redirectUri: z.string(),
});

const stripeEnvironmentSchema = z.object({
  secretKey: z.string(),
  webhookSecret: z.string(),
});

export const setupSecretsSchema = z.object({
  neon: z.object({
    apiKey: z.string(),
    orgId: z.string().optional(),
  }),
  upstash: z.object({
    redisUrl: z.string(),
  }),
  aws: z.object({
    accessKeyId: z.string(),
    secretAccessKey: z.string(),
  }),
  sentry: z.object({
    authToken: z.string(),
  }),
  resend: z.object({
    apiKey: z.string(),
  }),
  stripe: z.record(z.string(), stripeEnvironmentSchema).optional().default({}),
  oauth: z
    .object({
      google: z.record(z.string(), oauthEnvironmentSchema).optional().default({}),
      github: z.record(z.string(), oauthEnvironmentSchema).optional().default({}),
    })
    .optional()
    .default({}),
  railway: z.object({
    token: z.string(),
  }),
  postman: z
    .object({
      apiKey: z.string(),
      workspaceId: z.string(),
    })
    .optional()
    .default({ apiKey: '', workspaceId: '' }),
});

/**
 * Load secrets from .env.setup and process.env only. Config is required.
 */
export function loadSecrets(config: SetupConfig): z.infer<typeof setupSecretsSchema> {
  const environmentNames = config.environments.map((environment) => environment.name);
  return loadSecretsFromEnv(environmentNames);
}

export function reloadSecrets(config: SetupConfig): z.infer<typeof setupSecretsSchema> {
  return loadSecrets(config);
}

/** Ensure .env.setup exists (write template if missing). Returns true if template was written. */
export function ensureEnvSetupTemplate(config: SetupConfig): boolean {
  return writeEnvSetupTemplateIfMissing(config);
}

export function isSecretFilled(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function getSecretsPath(): string {
  return envSecretsPath();
}
