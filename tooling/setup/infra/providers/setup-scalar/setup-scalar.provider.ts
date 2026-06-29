/**
 * Scalar Registry provider for `pnpm setup:infra`.
 *
 * Generates the OpenAPI document and publishes it to the Scalar Registry under
 * the configured team namespace, mirroring the Postman provider. Reuses the
 * `pnpm docs:generate` and `pnpm docs:upload:scalar` scripts so the registry
 * publish logic lives in one place (src/scripts/codegen/upload-scalar-registry.ts).
 *
 * NAMING (single source of truth = setup.config.json): organization/project names from
 * `config.project.*` (registry slug defaults to `config.project.name`), environment names
 * from `config.environments[].name` — never hardcoded.
 * SECRETS: written to `.env.<environment>` only (via build-env-vars), never printed to the
 * console; `.setup-state.json` is gitignored and unreadable by the agent (deny-read guard). See SETUP_INFRA_PROVIDER_TEMPLATE.md.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as logger from '@tooling/setup/common/logger.js';
import { resourceStatus } from '@tooling/setup/common/interactive-step.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import { buildEnvironmentVariables } from '@tooling/setup/envs/build-env-vars.js';
import { refreshEnvFiles } from '@tooling/setup/envs/export-env-files.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

// import.meta.dirname is tooling/setup/infra/providers/setup-scalar — five levels
// below the repository root.
const PROJECT_ROOT = resolve(import.meta.dirname, '../../../../../');
const OPENAPI_SPEC_PATH = resolve(PROJECT_ROOT, 'docs', 'openapi', 'openapi.json');
const SCALAR_REGISTRY_BASE_URL = 'https://registry.scalar.com';
// NAMING (single source of truth = setup.config.json): the Scalar registry slug
// defaults to the PROJECT NAME (`config.project.name`) — never hardcode it here.
// SCALAR_SLUG in .env.setup is only an explicit override.

function toProcessEnvironment(
  variables: ReturnType<typeof buildEnvironmentVariables>,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env };
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string' && value.length > 0) {
      environment[key] = value;
    }
  }
  return environment;
}

function buildRegistryUrl(namespace: string, slug: string): string {
  return `${SCALAR_REGISTRY_BASE_URL}/@${namespace}/apis/${slug}/latest`;
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
): Promise<ProviderResult> {
  if (!(secrets.scalar?.apiKey && secrets.scalar?.namespace)) {
    return { success: true, message: 'Scalar: skipped (no API key or namespace)' };
  }

  // Refresh .env.<environment> from current state so the subprocess' dotenv
  // loader doesn't override the injected env with stale empty values.
  refreshEnvFiles();

  const defaultEnvironmentName =
    config.environments.find((environment) => environment.isDefault)?.name ??
    config.environments[0]?.name ??
    'development';
  const environment = toProcessEnvironment(
    buildEnvironmentVariables(defaultEnvironmentName, config, secrets, state),
  );

  const spinner = logger.startSpinner('Generating OpenAPI spec...');

  try {
    execSync('pnpm docs:generate', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
      env: environment,
    });

    logger.stopSpinner(spinner, 'OpenAPI spec generated');

    if (!existsSync(OPENAPI_SPEC_PATH)) {
      logger.warn('OpenAPI spec not found — skipping Scalar Registry publish');
      return {
        success: true,
        message: 'Scalar: spec generated but file not found for upload',
      };
    }

    const uploadSpinner = logger.startSpinner('Publishing OpenAPI document to Scalar Registry...');

    execSync('pnpm docs:upload:scalar', {
      cwd: PROJECT_ROOT,
      stdio: 'pipe',
      encoding: 'utf-8',
      timeout: 60000,
      env: environment,
    });

    const slug = secrets.scalar.slug || config.project.name;
    const registryUrl = buildRegistryUrl(secrets.scalar.namespace, slug);

    logger.stopSpinner(uploadSpinner, `Scalar Registry published: ${registryUrl}`);

    return {
      success: true,
      message: 'Scalar: OpenAPI document published to registry',
      stateUpdates: {
        scalar: { namespace: secrets.scalar.namespace, slug, registryUrl },
      },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`Scalar provisioning failed: ${message}`);
    return { success: false, message };
  }
}

export const setupScalarProvider: InfraProvider = {
  key: 'scalar',
  name: 'Scalar',
  isEnabled: ({ config, secrets }) =>
    config.providers.scalar.enabled && isSecretFilled(secrets.scalar?.apiKey),
  disabledReason: ({ config }) =>
    !config.providers.scalar.enabled
      ? 'disabled in setup.config.json'
      : 'SCALAR_API_KEY missing in .env.setup',
  preview: ({ config }) =>
    config.providers.scalar.enabled
      ? {
          detail: 'API key + namespace',
          url: 'https://dashboard.scalar.com',
          configKey: 'scalar.apiKey, scalar.namespace',
        }
      : null,
  settingsReview: ({ config }) =>
    config.providers.scalar.enabled
      ? [{ bucket: 'extra', provider: 'Scalar', detail: 'publish OpenAPI to registry' }]
      : [],
  describe: ({ config }) => ({ project: config.project.name }),
  buildStep: (context: InfraProviderContext) => ({
    name: 'Scalar',
    enabled: setupScalarProvider.isEnabled(context),
    enabledReason: setupScalarProvider.disabledReason(context),
    instructions: [
      'Will generate the OpenAPI document and publish it to your Scalar Registry namespace.',
      'Idempotent: re-publishing overrides the existing version (scalar registry publish --force).',
    ],
    detectStatus: () =>
      resourceStatus(Boolean(context.state.scalar?.registryUrl), 'Scalar Registry published'),
    execute: async () => {
      const result = await provision(context.config, context.secrets, context.state);
      context.applyStateUpdates(result.stateUpdates ?? {});
      if (!result.success) throw new Error(result.message);
      return result;
    },
  }),
  deleteInstructions: ({ state }) => {
    if (!state.scalar?.registryUrl) return [];
    const namespace = state.scalar.namespace ?? '';
    const slug = state.scalar.slug ?? '';
    return [
      {
        provider: 'Scalar',
        dashboardUrl: 'https://dashboard.scalar.com',
        steps: [
          'Open the Scalar dashboard → Registry.',
          `Locate the API by namespace/slug and delete it (or run: pnpm exec scalar registry delete ${namespace} ${slug}).`,
        ],
        resources: [{ label: 'Registry URL', identifier: state.scalar.registryUrl }],
      },
    ];
  },
};
