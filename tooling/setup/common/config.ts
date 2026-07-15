import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { SetupError } from './setup-error.js';

const sampleRatesSchema = z.object({
  traces: z.number().min(0).max(1),
  profile: z.number().min(0).max(1),
});

const environmentSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1),
  nodeEnvironment: z.enum(['development', 'production']),
  // `protected` mirrors the GitHub branch-protection status used by deploy
  // gates (`development` and `production` are protected by default;
  // ephemeral / preview environments may set `protected: false`). Single trunk:
  // every environment deploys from `git.defaultBranch`, so there is no
  // per-environment branch.
  protected: z.boolean(),
  isDefault: z.boolean().optional(),
});

const perEnvironmentString = z.record(z.string(), z.string());
const perEnvironmentNumber = z.record(z.string(), z.number());

const projectArtifactsSchema = z.object({
  apiImage: z.string().min(1),
  workerImage: z.string().min(1),
  dockerLocalApiTag: z.string().min(1),
  ghcrCacheScopeApi: z.string().min(1),
  ghcrCacheScopeWorker: z.string().min(1),
});

const projectGitSchema = z.object({
  protectedBranches: z.array(z.string().min(1)).min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
});

export const setupConfigSchema = z.object({
  // ─── NAMING — SINGLE SOURCE OF TRUTH ────────────────────────────────────────
  // setup.config.json is the ONE place these names are defined. Every setup script
  // and provider MUST read them from the loaded config — never hardcode a literal:
  //   • project.name         — PROJECT NAME (e.g. slugs, image tags, Scalar slug)
  //   • project.displayName   — human-readable PROJECT NAME (logs, email "from name")
  //   • project.organization  — ORGANIZATION NAME (Sentry org, GitHub owner, etc.)
  //   • environments[].name   — ENVIRONMENT NAMES (the only valid env identifiers;
  //                             alias maps like dev→development only NORMALIZE input)
  // Change a name here and re-run `pnpm tool:generate-project-identity`.
  project: z.object({
    name: z.string().min(1),
    displayName: z.string().min(1),
    organization: z.string().min(1),
    artifacts: projectArtifactsSchema.optional(),
  }),
  git: projectGitSchema.optional(),
  /**
   * Product-level name for resources SHARED by the backend and frontend (PostHog project,
   * Turnstile widget) — named `<product.name>-<env>` (e.g. `core-development`). Optional;
   * defaults to `project.name` so existing configs keep backend-centric naming.
   */
  product: z.object({ name: z.string().min(1) }).optional(),
  /**
   * Frontend (core-fe) identity. `name` is the frontend's Sentry project (separate from the
   * backend project); `url` is the per-environment frontend origin (used for the Turnstile widget
   * domain list). Optional — omit when there is no separate frontend.
   */
  frontend: z
    .object({
      name: z.string().min(1),
      url: perEnvironmentString.optional(),
    })
    .optional(),
  environments: z.array(environmentSchema).min(1),
  providers: z.object({
    neon: z.object({
      enabled: z.boolean(),
      region: z.string().min(1),
      pgVersion: z.number().int().min(17).max(17).default(17),
      computeSize: z.object({
        min: z.number().min(0.25),
        max: z.number().min(0.25),
      }),
    }),
    railwayRedis: z.object({
      enabled: z.boolean(),
      // Image, start command, password, and volume are managed by Railway's
      // `redis` database template (deployed via `templateDeployV2`). The
      // fields below are post-deploy overrides applied with
      // `serviceInstanceUpdate`; leave them unset to inherit Railway defaults.
      region: z.string().min(1).optional(),
      cpuLimit: z.number().positive().optional(),
      memoryLimitMb: z.number().int().positive().optional(),
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
      // Empty => derived at emit time so a project rename auto-updates them:
      //   fromAddress -> noreply@<project.name>.com   (see resolveResendFromAddress)
      //   fromName    -> <project.displayName>          (see resolveResendFromName)
      // Set a non-empty value here to pin an explicit override (e.g. a verified domain).
      fromAddress: z.string().default(''),
      fromName: z.string().default(''),
    }),
    stripe: z.object({
      enabled: z.boolean(),
    }),
    oauth: z.object({
      google: z.object({ enabled: z.boolean() }),
      github: z.object({ enabled: z.boolean() }),
    }),
    posthog: z.object({
      enabled: z.boolean(),
      region: z.enum(['us', 'eu']).default('us'),
    }),
    turnstile: z.object({ enabled: z.boolean() }),
    railway: z.object({ enabled: z.boolean() }),
    github: z.object({
      enabled: z.boolean(),
      repository: z.string().regex(/^[^/]+\/[^/]+$/),
      /**
       * Push local `.env.<environment>` secrets/variables to GitHub Environments as the final
       * "Sync .env.<environment> to GitHub Environments" step. Set to false to skip
       * that sync entirely (e.g. when GitHub Environment config is managed elsewhere, or to avoid
       * GitHub's secondary rate limit). Branch/ruleset/environment creation is unaffected. Default true.
       */
      syncEnvironments: z.boolean().default(true),
    }),
    postman: z.object({ enabled: z.boolean() }),
    scalar: z.object({ enabled: z.boolean() }),
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

type ParsedSetupConfig = z.infer<typeof setupConfigSchema>;

function buildDefaultArtifacts(
  projectSlug: string,
): NonNullable<ParsedSetupConfig['project']['artifacts']> {
  return {
    apiImage: `${projectSlug}-api`,
    workerImage: `${projectSlug}-worker`,
    dockerLocalApiTag: projectSlug,
    ghcrCacheScopeApi: `${projectSlug}-api`,
    ghcrCacheScopeWorker: `${projectSlug}-worker`,
  };
}

function normalizeLoadedConfig(config: ParsedSetupConfig): ParsedSetupConfig {
  const artifacts = config.project.artifacts ?? buildDefaultArtifacts(config.project.name);
  const defaultBranch = config.git?.defaultBranch ?? 'main';
  const protectedBranches = config.git?.protectedBranches ?? [defaultBranch];

  return {
    ...config,
    project: { ...config.project, artifacts },
    git: { protectedBranches, defaultBranch },
  };
}

export function getConfigPath(): string {
  return CONFIG_PATH;
}

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

    return normalizeLoadedConfig(config);
  } catch {
    return null;
  }
}

export function loadConfig(): z.infer<typeof setupConfigSchema> {
  const config = loadConfigIfExists();
  if (!config) {
    throw new SetupError(`Config file not found or invalid: ${CONFIG_PATH}`, {
      hint: 'Create tooling/setup/setup.config.json (copy an existing project config and edit names/environments).',
    });
  }
  return config;
}

export function getEnvironmentNames(config: z.infer<typeof setupConfigSchema>): string[] {
  return config.environments.map((environment) => environment.name);
}

/**
 * Persists the config back to `tooling/setup/setup.config.json`. This file
 * doubles as the saved "answers" for project / organization / branches /
 * environments — when the user re-runs the sync they see the
 * previously chosen values as defaults and don't have to re-enter them.
 */
export function saveConfig(config: z.infer<typeof setupConfigSchema>): void {
  writeFileSync(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
