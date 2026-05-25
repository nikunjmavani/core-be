/**
 * Validate .env.<environment> files against the env schema.
 *
 * Compares keys in local .env.<env> files against the Zod env schema to
 * find missing required keys, empty values, and extra unknown keys.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '../common/logger.js';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../..');

/**
 * Parse a simple .env file into key-value pairs.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  const content = readFileSync(filePath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    result[key] = value;
  }
  return result;
}

// Required variables that every environment must have
const REQUIRED_VARS = [
  'PORT',
  'HTTP_BIND_HOST',
  'NODE_ENV',
  'LOG_LEVEL',
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'JWT_PRIVATE_KEY',
  'JWT_PUBLIC_KEY',
  'SECRETS_ENCRYPTION_KEY',
  'ALLOWED_ORIGINS',
  'RATE_LIMIT_MAX',
  'RATE_LIMIT_WINDOW_MS',
  'AUDIT_RETENTION_DAYS',
  'AUTH_SESSION_RETENTION_DAYS',
];

export interface EnvValidationResult {
  environment: string;
  missing: string[];
  empty: string[];
  extra: string[];
  valid: boolean;
}

/**
 * Validate a single .env.<environment> file.
 */
export function validateEnvFile(environment: string): EnvValidationResult {
  const filePath = resolve(PROJECT_ROOT, `.env.${environment}`);
  const missing: string[] = [];
  const empty: string[] = [];
  const extra: string[] = [];

  if (!existsSync(filePath)) {
    return { environment, missing: REQUIRED_VARS, empty: [], extra: [], valid: false };
  }

  const vars = parseEnvFile(filePath);
  const keys = new Set(Object.keys(vars));

  for (const required of REQUIRED_VARS) {
    if (!keys.has(required)) {
      missing.push(required);
    } else if (vars[required] === '') {
      empty.push(required);
    }
  }

  for (const key of keys) {
    // Known optional vars that may legitimately be empty
    const knownOptionals = [
      'DATABASE_MIGRATION_URL',
      'REDIS_BULLMQ_URL',
      'JWT_SIGNING_KID',
      'FRONTEND_URL',
      'METRICS_ENABLED',
      'RESEND_API_KEY',
      'EMAIL_FROM_ADDRESS',
      'EMAIL_FROM_NAME',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'OAUTH_GOOGLE_CLIENT_ID',
      'OAUTH_GOOGLE_CLIENT_SECRET',
      'OAUTH_GOOGLE_REDIRECT_URI',
      'OAUTH_GITHUB_CLIENT_ID',
      'OAUTH_GITHUB_CLIENT_SECRET',
      'OAUTH_GITHUB_REDIRECT_URI',
      'SENTRY_DSN',
      'SENTRY_ENVIRONMENT',
      'SENTRY_TRACES_SAMPLE_RATE',
      'SENTRY_PROFILE_SAMPLE_RATE',
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ];
    if (!REQUIRED_VARS.includes(key) && !knownOptionals.includes(key)) {
      extra.push(key);
    }
  }

  return {
    environment,
    missing,
    empty,
    extra,
    valid: missing.length === 0 && empty.length === 0,
  };
}

/**
 * Print validation results for one or all environments.
 */
export function printEnvValidation(environments: string[]): boolean {
  let allValid = true;

  for (const env of environments) {
    const result = validateEnvFile(env);

    if (!existsSync(resolve(PROJECT_ROOT, `.env.${env}`))) {
      logger.warn(`.env.${env} — file not found`);
      allValid = false;
      continue;
    }

    if (result.valid) {
      logger.success(`.env.${env} — valid`);
    } else {
      logger.error(`.env.${env} — issues found:`);
      for (const key of result.missing) {
        logger.error(`  ✗ ${key} — missing`);
      }
      for (const key of result.empty) {
        logger.error(`  ✗ ${key} — empty value`);
      }
      allValid = false;
    }

    if (result.extra.length > 0) {
      logger.warn(`.env.${env} — unknown keys (not in schema): ${result.extra.join(', ')}`);
    }
  }

  return allValid;
}
