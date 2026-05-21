/** Shared logic to build deploy environment variables (used by GitHub provider). */
import type { SetupConfig, SetupSecrets, SetupState, EnvironmentVariables } from './types.js';

/** Defaults match .env.example (required at app runtime). */
const DEFAULT_AUDIT_RETENTION_DAYS = '90';
const DEFAULT_SESSION_RETENTION_DAYS = '30';

export function buildEnvironmentVariables(
  environmentName: string,
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): EnvironmentVariables {
  const environment = config.environments.find((env) => env.name === environmentName);
  const sentryConfig = config.providers.sentry;

  const redisUrl =
    config.providers.upstash?.enabled && secrets.upstash?.redisUrl
      ? secrets.upstash.redisUrl
      : (state.redis?.databases?.[environmentName]?.redisUrl ?? '');

  const variables: EnvironmentVariables = {
    PORT: String(config.app.port),
    HOST: config.app.host,
    NODE_ENV: environment?.nodeEnvironment ?? 'development',
    LOG_LEVEL: environment?.nodeEnvironment === 'production' ? 'info' : 'debug',
    DATABASE_URL: state.neon?.branches?.[environmentName]?.databaseUrl ?? '',
    REDIS_URL: redisUrl,
    JWT_SECRET: state.jwt?.[environmentName] ?? '',
    ALLOWED_ORIGINS: config.app.allowedOrigins[environmentName] ?? '',
    FRONTEND_URL: config.app.frontendUrl[environmentName] ?? '',
    RATE_LIMIT_MAX: String(config.app.rateLimitMax[environmentName] ?? 100),
    RATE_LIMIT_WINDOW_MS: String(config.app.rateLimitWindowMs),
    AUDIT_RETENTION_DAYS: DEFAULT_AUDIT_RETENTION_DAYS,
    SESSION_RETENTION_DAYS: DEFAULT_SESSION_RETENTION_DAYS,
  };

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
