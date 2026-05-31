/** Shared logic to build deploy environment variables (used by GitHub provider). */
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  EnvironmentVariables,
} from '@tooling/setup/common/types.js';

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

export function buildEnvironmentVariables(
  environmentName: string,
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): EnvironmentVariables {
  const environment = config.environments.find((env) => env.name === environmentName);
  const defaultEnvironment =
    config.environments.find((env) => env.isDefault)?.name ?? config.environments[0]?.name;
  const sentryConfig = config.providers.sentry;

  const redisUrl = state.redis?.databases?.[environmentName]?.redisUrl ?? '';
  const jwtState = state.jwt?.[environmentName];
  const jwtSecret = typeof jwtState === 'string' ? jwtState : (jwtState?.jwtSecret ?? '');
  const railwayEnvironment = state.railway?.environments?.[environmentName];

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

  const variables: EnvironmentVariables = {
    PORT: String(config.app.port),
    HTTP_BIND_HOST: config.app.host,
    NODE_ENV: environment?.nodeEnvironment ?? 'development',
    LOG_LEVEL: environment?.nodeEnvironment === 'production' ? 'info' : 'debug',
    DATABASE_URL: state.neon?.branches?.[environmentName]?.databaseUrl ?? '',
    DATABASE_MIGRATION_URL:
      state.neon?.branches?.[environmentName]?.databaseMigrationUrl ??
      state.neon?.branches?.[environmentName]?.databaseUrl ??
      '',
    REDIS_URL: redisUrl,
    JWT_SECRET: jwtSecret,
    ALLOWED_ORIGINS: allowedOrigins,
    RATE_LIMIT_MAX: String(config.app.rateLimitMax[environmentName] ?? 100),
    RATE_LIMIT_WINDOW_MS: String(config.app.rateLimitWindowMs),
    METRICS_ENABLED: 'false',
    AUDIT_RETENTION_DAYS: DEFAULT_AUDIT_RETENTION_DAYS,
    AUTH_SESSION_RETENTION_DAYS: DEFAULT_SESSION_RETENTION_DAYS,
  };

  if (config.providers.railway.enabled && secrets.railway.token) {
    variables.RAILWAY_TOKEN = secrets.railway.token;
    const apiServiceId = railwayEnvironment?.services.api?.serviceId;
    const workerServiceId = railwayEnvironment?.services.worker?.serviceId;
    if (apiServiceId) variables.RAILWAY_SERVICE_ID = apiServiceId;
    if (workerServiceId) variables.RAILWAY_WORKER_SERVICE_ID = workerServiceId;
  }

  if (config.providers.postman.enabled && secrets.postman?.apiKey) {
    variables.POSTMAN_API_KEY = secrets.postman.apiKey;
    if (secrets.postman.workspaceId) {
      variables.POSTMAN_WORKSPACE_ID = secrets.postman.workspaceId;
    }
  }

  if (frontendUrl) {
    variables.FRONTEND_URL = frontendUrl;
  }

  if (typeof jwtState !== 'string') {
    if (jwtState?.jwtPrivateKey) variables.JWT_PRIVATE_KEY = jwtState.jwtPrivateKey;
    if (jwtState?.jwtPublicKey) variables.JWT_PUBLIC_KEY = jwtState.jwtPublicKey;
    if (jwtState?.jwtSigningKid) variables.JWT_SIGNING_KID = jwtState.jwtSigningKid;
    if (jwtState?.secretsEncryptionKey) {
      variables.SECRETS_ENCRYPTION_KEY = jwtState.secretsEncryptionKey;
    }
  }

  if (config.providers.resend.enabled && secrets.resend.apiKey) {
    variables.RESEND_API_KEY = secrets.resend.apiKey;
    variables.EMAIL_FROM_ADDRESS = config.providers.resend.fromAddress;
    variables.EMAIL_FROM_NAME = config.providers.resend.fromName;
  }

  const stripeEnvironment = secrets.stripe?.[environmentName];
  if (config.providers.stripe.enabled && stripeEnvironment?.secretKey) {
    variables.STRIPE_SECRET_KEY = stripeEnvironment.secretKey;
    variables.STRIPE_WEBHOOK_SECRET = stripeEnvironment.webhookSecret;
  }

  const googleOAuth = secrets.oauth?.google?.[environmentName];
  if (config.providers.oauth.google.enabled && googleOAuth?.clientId) {
    variables.OAUTH_GOOGLE_CLIENT_ID = googleOAuth.clientId;
    variables.OAUTH_GOOGLE_CLIENT_SECRET = googleOAuth.clientSecret;
    variables.OAUTH_GOOGLE_REDIRECT_URI = googleOAuth.redirectUri;
  }

  const githubOAuth = secrets.oauth?.github?.[environmentName];
  if (config.providers.oauth.github.enabled && githubOAuth?.clientId) {
    variables.OAUTH_GITHUB_CLIENT_ID = githubOAuth.clientId;
    variables.OAUTH_GITHUB_CLIENT_SECRET = githubOAuth.clientSecret;
    variables.OAUTH_GITHUB_REDIRECT_URI = githubOAuth.redirectUri;
  }

  if (sentryConfig.enabled && state.sentry?.dsn) {
    variables.SENTRY_DSN = state.sentry.dsn;
    variables.SENTRY_ENVIRONMENT = environmentName;
    const rates = sentryConfig.sampleRates[environmentName];
    if (rates) {
      variables.SENTRY_TRACES_SAMPLE_RATE = String(rates.traces);
      variables.SENTRY_PROFILE_SAMPLE_RATE = String(rates.profile);
    }
  }

  const awsUser = state.aws?.iamUsers?.[environmentName];
  const awsBucket = state.aws?.buckets?.[environmentName];
  if (config.providers.aws.enabled && awsBucket && awsUser) {
    variables.S3_BUCKET = awsBucket.name;
    variables.S3_REGION = awsBucket.region;
    variables.S3_ACCESS_KEY_ID = awsUser.accessKeyId;
    variables.S3_SECRET_ACCESS_KEY = awsUser.secretAccessKey;
  }

  return variables;
}
