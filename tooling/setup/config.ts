import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import * as logger from './logger.util.js';

const sampleRatesSchema = z.object({
  traces: z.number().min(0).max(1),
  profile: z.number().min(0).max(1),
});

const environmentSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  nodeEnvironment: z.enum(['development', 'production']),
  isDefault: z.boolean().optional(),
});

const perEnvironmentString = z.record(z.string(), z.string());
const perEnvironmentNumber = z.record(z.string(), z.number());

export const setupConfigSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    organization: z.string().min(1),
  }),
  environments: z.array(environmentSchema).min(1),
  providers: z.object({
    neon: z.object({
      enabled: z.boolean(),
      region: z.string().min(1),
      pgVersion: z.number().int().min(14).max(17).default(17),
      computeSize: z.object({
        min: z.number().min(0.25),
        max: z.number().min(0.25),
      }),
    }),
    upstash: z.object({
      enabled: z.boolean(),
    }),
    aws: z.object({
      enabled: z.boolean(),
      region: z.string().min(1),
      s3BucketPrefix: z.string().min(1),
      iamUserPrefix: z.string().min(1),
    }),
    sentry: z
      .object({
        enabled: z.boolean(),
        organization: z.string().min(1),
        project: z.string().min(1).optional(),
        team: z.string().min(1).optional(),
        platform: z.string().default('node'),
        sampleRates: z.record(z.string(), sampleRatesSchema),
      })
      .refine((s) => (s.project ?? s.team) != null, {
        message: 'sentry.project or sentry.team required',
      }),
    resend: z.object({
      enabled: z.boolean(),
      fromAddress: z.string().min(1),
      fromName: z.string().min(1),
    }),
    stripe: z.object({ enabled: z.boolean() }),
    oauth: z.object({
      google: z.object({ enabled: z.boolean() }),
      github: z.object({ enabled: z.boolean() }),
    }),
    railway: z.object({ enabled: z.boolean() }),
    github: z.object({
      enabled: z.boolean(),
      repository: z.string().regex(/^[^/]+\/[^/]+$/),
    }),
    postman: z.object({ enabled: z.boolean() }),
  }),
  app: z.object({
    port: z.number().int().default(3000),
    host: z.string().default('0.0.0.0'),
    rateLimitMax: perEnvironmentNumber,
    rateLimitWindowMs: z.number().int().default(60000),
    frontendUrl: perEnvironmentString,
    allowedOrigins: perEnvironmentString,
  }),
});

const CONFIG_PATH = resolve(import.meta.dirname, '../setup.config.json');

/** Load config if file exists and is valid. Returns null when missing or invalid (for init defaults). */
export function loadConfigIfExists(): z.infer<typeof setupConfigSchema> | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    const result = setupConfigSchema.safeParse(parsed);
    if (!result.success) {
      return null;
    }

    const config = result.data;

    // Normalize Sentry config: prefer explicit project, but when only team is set,
    // treat the project as the core-be project name so previews show organization/project.
    if (
      config.providers.sentry.enabled &&
      !config.providers.sentry.project &&
      config.providers.sentry.team
    ) {
      config.providers.sentry.project = config.project.name;
    }

    return config;
  } catch {
    return null;
  }
}

export function loadConfig(): z.infer<typeof setupConfigSchema> {
  const config = loadConfigIfExists();
  if (!config) {
    logger.error(`Config file not found or invalid: ${CONFIG_PATH}`);
    logger.info('Run pnpm setup:infra:init to create tooling/setup.config.json.');
    process.exit(1);
  }
  return config;
}

export function getEnvironmentNames(config: z.infer<typeof setupConfigSchema>): string[] {
  return config.environments.map((environment) => environment.name);
}
