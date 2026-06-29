/** Shared logic to build deploy environment variables (used by GitHub provider). */
import type {
  EnvironmentVariables,
  InfraProviderContext,
  SetupConfig,
  SetupSecrets,
  SetupState,
} from '@tooling/setup/common/types.js';
import { INFRA_PROVIDERS } from '@tooling/setup/infra/providers/index.js';

/** Defaults match .env.example (required at app runtime). */
const DEFAULT_AUDIT_RETENTION_DAYS = '90';
const DEFAULT_SESSION_RETENTION_DAYS = '30';

function pickPerEnvironmentString(
  perEnvironment: Record<string, string> | undefined,
  environmentName: string,
  defaultEnvironmentName: string | undefined,
): string {
  const explicit = perEnvironment?.[environmentName]?.trim();
  if (explicit) return explicit;
  if (defaultEnvironmentName && defaultEnvironmentName !== environmentName) {
    return perEnvironment?.[defaultEnvironmentName]?.trim() ?? '';
  }
  return '';
}

/**
 * Build the `.env.<environment>` variable map for one environment.
 *
 * @remarks
 * **Composition:** baseline keys (config-derived: ports, NODE_ENV, rate limits, retention,
 * ALLOWED_ORIGINS/FRONTEND_URL) are set first, then each provider contributes its own slice
 * via `provider.toEnvironmentVariables()` — so adding a provider never touches this file. The
 * required-but-provisioned keys (`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`) start as empty
 * defaults and are overwritten by their owning provider (Neon / Railway Redis / JWT) when
 * state is populated. **Side effects:** none (pure). App per-env secrets (Stripe / OAuth /
 * Turnstile) are intentionally NOT produced here — they live directly in `.env.<environment>`.
 */
export function buildEnvironmentVariables(
  environmentName: string,
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): EnvironmentVariables {
  const environment = config.environments.find((env) => env.name === environmentName);
  const defaultEnvironment =
    config.environments.find((env) => env.isDefault)?.name ?? config.environments[0]?.name;

  const allowedOrigins = pickPerEnvironmentString(
    config.app.allowedOrigins,
    environmentName,
    defaultEnvironment,
  );
  const frontendUrl = pickPerEnvironmentString(
    config.app.frontendUrl,
    environmentName,
    defaultEnvironment,
  );

  // Baseline: config-derived keys + required-key defaults (providers overwrite the provisioned ones).
  const variables: EnvironmentVariables = {
    PORT: String(config.app.port),
    HTTP_BIND_HOST: config.app.host,
    NODE_ENV: environment?.nodeEnvironment ?? 'development',
    LOG_LEVEL: environment?.nodeEnvironment === 'production' ? 'info' : 'debug',
    DATABASE_URL: '',
    REDIS_URL: '',
    JWT_SECRET: '',
    ALLOWED_ORIGINS: allowedOrigins,
    RATE_LIMIT_MAX: String(config.app.rateLimitMax[environmentName] ?? 100),
    RATE_LIMIT_WINDOW_MS: String(config.app.rateLimitWindowMs),
    METRICS_ENABLED: 'false',
    AUDIT_RETENTION_DAYS: DEFAULT_AUDIT_RETENTION_DAYS,
    AUTH_SESSION_RETENTION_DAYS: DEFAULT_SESSION_RETENTION_DAYS,
  };
  if (frontendUrl) {
    variables.FRONTEND_URL = frontendUrl;
  }

  // Each provider owns its own `.env.<environment>` slice (Neon → DATABASE_URL, AWS → S3_*, …).
  const context: InfraProviderContext = {
    config,
    secrets,
    state,
    environments: config.environments.map((env) => env.name),
    applyStateUpdates: () => {},
  };
  for (const provider of INFRA_PROVIDERS) {
    Object.assign(variables, provider.toEnvironmentVariables?.(context, environmentName) ?? {});
  }

  return variables;
}
