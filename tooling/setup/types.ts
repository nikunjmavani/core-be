import type { z } from 'zod';
import type { setupConfigSchema } from './config.js';
import type { setupSecretsSchema } from './secrets.js';
import type { setupStateSchema } from './state.js';

export type SetupConfig = z.infer<typeof setupConfigSchema>;
export type SetupSecrets = z.infer<typeof setupSecretsSchema>;
export type SetupState = z.infer<typeof setupStateSchema>;

export type SetupCommand = 'provision' | 'check' | 'status' | 'update' | 'destroy';

export type EnvironmentName = string;

export interface ProviderContext {
  config: SetupConfig;
  secrets: SetupSecrets;
  state: SetupState;
  environments: string[];
}

export interface ProviderResult {
  success: boolean;
  message: string;
  stateUpdates?: Partial<SetupState>;
}

export interface HealthCheckResult {
  provider: string;
  environment?: string;
  healthy: boolean;
  message: string;
}

export interface EnvironmentVariables {
  PORT: string;
  HOST: string;
  NODE_ENV: string;
  LOG_LEVEL: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  REDIS_BULLMQ_URL?: string;
  JWT_SECRET: string;
  ALLOWED_ORIGINS: string;
  FRONTEND_URL: string;
  RATE_LIMIT_MAX: string;
  RATE_LIMIT_WINDOW_MS: string;
  AUDIT_RETENTION_DAYS: string;
  SESSION_RETENTION_DAYS: string;
  TOMBSTONE_RETENTION_DAYS?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM_ADDRESS?: string;
  EMAIL_FROM_NAME?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  OAUTH_GOOGLE_CLIENT_ID?: string;
  OAUTH_GOOGLE_CLIENT_SECRET?: string;
  OAUTH_GOOGLE_REDIRECT_URI?: string;
  OAUTH_GITHUB_CLIENT_ID?: string;
  OAUTH_GITHUB_CLIENT_SECRET?: string;
  OAUTH_GITHUB_REDIRECT_URI?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_TRACES_SAMPLE_RATE?: string;
  SENTRY_PROFILE_SAMPLE_RATE?: string;
  S3_BUCKET?: string;
  S3_REGION?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
}

export interface GuideStep {
  stepNumber: number;
  totalSteps: number;
  providerName: string;
  secretsKeys: string[];
  browserUrl: string;
  instructions: string[];
}
