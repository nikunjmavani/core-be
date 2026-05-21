/**
 * Publishes the OpenAPI document to the Scalar Registry.
 *
 * Required env vars:
 *   SCALAR_API_KEY       — Scalar API key (https://scalar.com/products/agent/key)
 *   SCALAR_NAMESPACE     — Scalar team namespace
 *   SCALAR_SLUG          — Registry slug (default: core-be)
 *
 * Optional:
 *   OPENAPI_SPEC_PATH    — Path to OpenAPI JSON (default: docs/openapi/openapi.json)
 *   SCALAR_VERSION       — Registry version label (default: package.json version)
 *
 * Run: pnpm docs:upload:scalar
 */
import '@/shared/config/load-env-files.js';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { shouldSkipHostedUpload } from './hosted-docs-upload.util.js';

const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json');
const DEFAULT_OPENAPI_SPEC_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');
const DEFAULT_SCALAR_SLUG = 'core-be';
const SCALAR_REGISTRY_BASE_URL = 'https://registry.scalar.com';

const SCALAR_UPLOAD_REQUIRED_VARIABLES = ['SCALAR_API_KEY', 'SCALAR_NAMESPACE'] as const;

function getRequiredEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function resolveOpenApiSpecPath(): string {
  const fromEnvironment = process.env.OPENAPI_SPEC_PATH;
  if (!fromEnvironment) {
    return DEFAULT_OPENAPI_SPEC_PATH;
  }
  return isAbsolute(fromEnvironment) ? fromEnvironment : join(process.cwd(), fromEnvironment);
}

function getPackageVersion(): string {
  const packageData = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf-8')) as {
    version?: string;
  };
  return packageData.version ?? '0.0.0';
}

function buildRegistryUrl(namespace: string, slug: string): string {
  return `${SCALAR_REGISTRY_BASE_URL}/@${namespace}/apis/${slug}/latest`;
}

function runScalarCommand(argumentsList: string[]): void {
  const result = spawnSync('pnpm', ['exec', 'scalar', ...argumentsList], {
    stdio: 'inherit',
    cwd: process.cwd(),
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function main(): void {
  if (shouldSkipHostedUpload('Scalar Registry', SCALAR_UPLOAD_REQUIRED_VARIABLES)) {
    return;
  }

  const apiKey = getRequiredEnvironmentVariable('SCALAR_API_KEY');
  const namespace = getRequiredEnvironmentVariable('SCALAR_NAMESPACE');
  const slug = process.env.SCALAR_SLUG ?? DEFAULT_SCALAR_SLUG;
  const version = process.env.SCALAR_VERSION ?? getPackageVersion();
  const openApiSpecPath = resolveOpenApiSpecPath();

  if (!existsSync(openApiSpecPath)) {
    console.error(`OpenAPI spec not found at ${openApiSpecPath}. Run pnpm docs:generate first.`);
    process.exit(1);
  }

  console.log(`Publishing ${openApiSpecPath} to Scalar Registry (${namespace}/${slug})...`);

  runScalarCommand(['auth', 'login', '--token', apiKey]);
  runScalarCommand([
    'registry',
    'publish',
    openApiSpecPath,
    '--namespace',
    namespace,
    '--slug',
    slug,
    '--version',
    version,
    '--force',
  ]);

  const registryUrl = buildRegistryUrl(namespace, slug);
  console.log(`Published to Scalar Registry: ${registryUrl}`);
}

main();
