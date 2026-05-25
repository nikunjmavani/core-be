import * as logger from '../../../common/logger.js';
import { isSecretFilled } from '../../../common/secrets.js';
import type {
  SetupConfig,
  SetupSecrets,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '../../../common/types.js';

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

function neonHeaders(apiKey: string, orgId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (orgId) {
    headers['Neon-Org-Id'] = orgId;
  }
  return headers;
}

async function neonRequest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
  query?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${NEON_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url.toString(), {
    method,
    headers: neonHeaders(apiKey),
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Neon API ${method} ${path} failed (${response.status}): ${errorBody}`);
  }

  return response.json() as Promise<T>;
}

interface NeonOrganization {
  id: string;
  name: string;
  created_at?: string;
}

interface NeonOrganizationsResponse {
  organizations: NeonOrganization[];
}

/** Resolve Neon org_id: fetch user's organizations and pick one (by name match or first). */
async function resolveNeonOrgId(
  apiKey: string,
  preferredOrganizationName?: string,
): Promise<string> {
  const response = await neonRequest<
    NeonOrganizationsResponse & { data?: { organizations?: NeonOrganization[] } }
  >(apiKey, 'GET', '/users/me/organizations');
  const organizations = response.data?.organizations ?? response.organizations ?? [];
  if (organizations.length === 0) {
    throw new Error(
      'No Neon organization found. Create one at https://console.neon.tech/app/settings or use an organization API key.',
    );
  }
  const match =
    preferredOrganizationName &&
    organizations.find(
      (org) =>
        org.name?.toLowerCase() === preferredOrganizationName.toLowerCase() ||
        org.id === preferredOrganizationName,
    );
  const organization = match ?? organizations[0];
  const orgId = organization?.id;
  if (!orgId) {
    throw new Error(
      `Neon organization has no id. Response: ${JSON.stringify(organization)}. Check https://console.neon.tech/app/settings.`,
    );
  }
  return orgId;
}

interface NeonProject {
  project: {
    id: string;
    name: string;
  };
  connection_uris?: Array<{
    connection_uri: string;
  }>;
}

interface NeonBranch {
  branch: {
    id: string;
    name: string;
  };
  endpoints?: Array<{
    id: string;
    host: string;
  }>;
  connection_uris?: Array<{
    connection_uri: string;
  }>;
}

interface NeonConnectionUri {
  uri: string;
}

interface NeonProjectSummary {
  id: string;
  name: string;
}

interface NeonProjectsListResponse {
  projects: NeonProjectSummary[];
}

async function findExistingProjectId(
  apiKey: string,
  projectName: string,
): Promise<string | undefined> {
  const response = await neonRequest<NeonProjectsListResponse>(apiKey, 'GET', '/projects');
  return response.projects.find((project) => project.name === projectName)?.id;
}

interface NeonBranchSummary {
  id: string;
  name: string;
}

interface NeonBranchesListResponse {
  branches: NeonBranchSummary[];
}

async function listBranches(apiKey: string, projectId: string): Promise<NeonBranchSummary[]> {
  const response = await neonRequest<NeonBranchesListResponse>(
    apiKey,
    'GET',
    `/projects/${projectId}/branches`,
  );
  return response.branches ?? [];
}

interface NeonOperation {
  id: string;
  action: string;
  status: string;
}

interface NeonOperationsResponse {
  operations: NeonOperation[];
}

const NEON_OPERATION_TERMINAL_STATUSES = new Set([
  'finished',
  'failed',
  'error',
  'cancelled',
  'skipped',
]);
const NEON_OPERATION_POLL_INTERVAL_MS = 2000;
const NEON_OPERATION_POLL_TIMEOUT_MS = 120_000;

/**
 * Poll Neon's operations endpoint until all pending operations reach a terminal status.
 * Neon project / branch mutations are asynchronous; subsequent calls can return 423 if
 * the project still has operations in flight.
 */
async function waitForOperations(apiKey: string, projectId: string): Promise<void> {
  const deadline = Date.now() + NEON_OPERATION_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const response = await neonRequest<NeonOperationsResponse>(
      apiKey,
      'GET',
      `/projects/${projectId}/operations`,
    );
    const pending = (response.operations ?? []).filter(
      (operation) => !NEON_OPERATION_TERMINAL_STATUSES.has(operation.status),
    );
    if (pending.length === 0) return;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, NEON_OPERATION_POLL_INTERVAL_MS));
  }
  throw new Error(
    `Neon project "${projectId}" still has pending operations after ${Math.round(
      NEON_OPERATION_POLL_TIMEOUT_MS / 1000,
    )}s; aborting to avoid 423 conflicts.`,
  );
}

const NEON_DEFAULT_ROLE = 'neondb_owner';
const NEON_DEFAULT_DATABASE = 'neondb';

async function getConnectionUri(
  apiKey: string,
  projectId: string,
  branchId: string,
  pooled: boolean,
): Promise<string> {
  const connectionResponse = await neonRequest<NeonConnectionUri>(
    apiKey,
    'GET',
    `/projects/${projectId}/connection_uri`,
    undefined,
    {
      branch_id: branchId,
      database_name: NEON_DEFAULT_DATABASE,
      role_name: NEON_DEFAULT_ROLE,
      pooled: String(pooled),
    },
  );
  return connectionResponse.uri;
}

export async function provision(
  config: SetupConfig,
  secrets: SetupSecrets,
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  const apiKey = secrets.neon.apiKey;
  const neonConfig = config.providers.neon;
  const projectName = config.project.name;

  const spinner = logger.startSpinner('Creating Neon project...');

  try {
    let projectId = state.neon?.projectId;
    const branches: Record<string, { branchId: string; endpointId: string; databaseUrl: string }> =
      state.neon?.branches ? { ...state.neon.branches } : {};

    // Adopt remote project by name when local state is missing the project ID.
    if (!projectId) {
      const existingProjectId = await findExistingProjectId(apiKey, projectName);
      if (existingProjectId) {
        projectId = existingProjectId;
        logger.stopSpinner(spinner, `Neon project adopted: ${projectId}`);
      }
    }

    if (!projectId) {
      // Both Personal and Organization API keys may require org_id — always resolve and send it (URL, header, body)
      let orgId: string =
        typeof secrets.neon.orgId === 'string' && secrets.neon.orgId.trim()
          ? secrets.neon.orgId.trim()
          : '';
      if (!orgId) {
        orgId = await resolveNeonOrgId(apiKey, config.project.organization);
      }
      if (!orgId) {
        throw new Error(
          `Neon org_id is required. Set NEON_ORG_ID in .env.setup (e.g. NEON_ORG_ID=org-xxx). Get it at https://console.neon.tech/app/settings → Organization → General.`,
        );
      }

      const projectBody = {
        project: {
          name: projectName,
          region_id: neonConfig.region,
          pg_version: neonConfig.pgVersion,
          default_endpoint_settings: {
            autoscaling_limit_min_cu: neonConfig.computeSize.min,
            autoscaling_limit_max_cu: neonConfig.computeSize.max,
          },
        },
      };

      const createProjectUrl = `${NEON_API_BASE}/projects?org_id=${encodeURIComponent(orgId)}`;
      logger.info(
        `Neon create project request: POST ${createProjectUrl} (body includes org_id and project)`,
      );

      const createResponse = await fetch(createProjectUrl, {
        method: 'POST',
        headers: neonHeaders(apiKey, orgId),
        body: JSON.stringify({ ...projectBody, org_id: orgId }),
      });

      const responseText = await createResponse.text();
      logger.info(
        `Neon create project response: status=${createResponse.status} body=${responseText.slice(0, 500)}${responseText.length > 500 ? '...' : ''}`,
      );

      if (!createResponse.ok) {
        throw new Error(
          `Neon API POST /projects failed (${createResponse.status}): ${responseText}`,
        );
      }
      const projectResponse = JSON.parse(responseText) as NeonProject;

      projectId = projectResponse.project.id;
      logger.stopSpinner(spinner, `Neon project created: ${projectId}`);

      // The default branch (main) is used for the last environment (typically prod)
      const productionEnvironment = environments[environments.length - 1];
      if (productionEnvironment && projectResponse.connection_uris?.[0]) {
        branches[productionEnvironment] = {
          branchId: 'main',
          endpointId: projectResponse.connection_uris[0].connection_uri ? 'default' : '',
          databaseUrl: projectResponse.connection_uris[0].connection_uri,
        };
      }
    } else {
      logger.stopSpinner(spinner, `Neon project already exists: ${projectId}`);
    }

    await waitForOperations(apiKey, projectId!);

    const remoteBranches = await listBranches(apiKey, projectId!);

    // Create branches for remaining environments
    const nonProductionEnvironments = environments.slice(0, -1);

    for (const environmentName of nonProductionEnvironments) {
      if (branches[environmentName]) {
        logger.success(`  Branch "${environmentName}" already exists`);
        continue;
      }

      const remoteBranch = remoteBranches.find((branch) => branch.name === environmentName);
      if (remoteBranch) {
        await waitForOperations(apiKey, projectId!);
        const adoptSpinner = logger.startSpinner(
          `Adopting existing Neon branch: ${environmentName}...`,
        );
        const databaseUrl = await getConnectionUri(apiKey, projectId!, remoteBranch.id, true);
        branches[environmentName] = {
          branchId: remoteBranch.id,
          endpointId: '',
          databaseUrl,
        };
        logger.stopSpinner(adoptSpinner, `Branch "${environmentName}" adopted: ${remoteBranch.id}`);
        continue;
      }

      const branchSpinner = logger.startSpinner(`Creating branch: ${environmentName}...`);

      await waitForOperations(apiKey, projectId!);

      const branchResponse = await neonRequest<NeonBranch>(
        apiKey,
        'POST',
        `/projects/${projectId}/branches`,
        {
          branch: { name: environmentName },
          endpoints: [{ type: 'read_write' }],
        },
      );

      const branchId = branchResponse.branch.id;
      const endpointId = branchResponse.endpoints?.[0]?.id ?? '';

      const databaseUrl =
        branchResponse.connection_uris?.[0]?.connection_uri ??
        (await getConnectionUri(apiKey, projectId!, branchId, true));

      branches[environmentName] = { branchId, endpointId, databaseUrl };
      logger.stopSpinner(branchSpinner, `Branch "${environmentName}" created: ${branchId}`);
    }

    // Fetch production connection URI if not yet set — resolve the actual production branch
    // (do not hard-code 'main') to avoid using a placeholder branch ID in state.
    const productionEnvironment = environments[environments.length - 1];
    if (productionEnvironment && !branches[productionEnvironment]?.databaseUrl) {
      const productionBranch =
        remoteBranches.find((branch) => branch.name === productionEnvironment) ??
        remoteBranches.find((branch) => branch.name === 'main') ??
        remoteBranches[0];
      if (!productionBranch) {
        throw new Error(
          `Neon project "${projectId}" has no branches; cannot resolve production connection URI.`,
        );
      }
      const databaseUrl = await getConnectionUri(apiKey, projectId!, productionBranch.id, true);
      branches[productionEnvironment] = {
        branchId: productionBranch.id,
        endpointId: 'default',
        databaseUrl,
      };
    }

    return {
      success: true,
      message: `Neon: ${Object.keys(branches).length} branches ready`,
      stateUpdates: { neon: { projectId: projectId!, branches } },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.stopSpinner(spinner, `Neon provisioning failed: ${message}`, 'fail');
    return { success: false, message };
  }
}

export async function check(state: SetupState, secrets: SetupSecrets): Promise<boolean> {
  if (!state.neon?.projectId) {
    logger.error('Neon: no project in state');
    return false;
  }

  try {
    await neonRequest(secrets.neon.apiKey, 'GET', `/projects/${state.neon.projectId}`);
    logger.success(`Neon project ${state.neon.projectId} — reachable`);
    return true;
  } catch {
    logger.error(`Neon project ${state.neon.projectId} — unreachable`);
    return false;
  }
}

function allEnvironmentsHaveBranch(environments: string[], state: SetupState): boolean {
  const branches = state.neon?.branches;
  if (!branches) return false;
  return environments.every((environmentName) => Boolean(branches[environmentName]?.databaseUrl));
}

export const setupNeonProvider: InfraProvider = {
  key: 'neon',
  name: 'Neon Postgres',
  isEnabled: ({ config, secrets }) =>
    config.providers.neon.enabled && isSecretFilled(secrets.neon.apiKey),
  disabledReason: ({ config }) =>
    !config.providers.neon.enabled
      ? 'disabled in setup.config.json'
      : 'NEON_API_KEY missing in .env.setup',
  preview: ({ config }) =>
    config.providers.neon.enabled
      ? {
          detail: '1 project + branches per env',
          url: 'https://console.neon.tech/app/settings/api-keys',
          configKey: 'neon.apiKey',
        }
      : null,
  settingsReview: ({ config, environments }) =>
    config.providers.neon.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'Neon Postgres',
            detail: `1 project + ${environments.length} branches (${config.providers.neon.region})`,
          },
        ]
      : [],
  detectExisting: async ({ config, secrets }) => {
    if (!config.providers.neon.enabled || !isSecretFilled(secrets.neon.apiKey)) return [];
    try {
      const response = await fetch('https://console.neon.tech/api/v2/projects', {
        headers: {
          Authorization: `Bearer ${secrets.neon.apiKey}`,
          Accept: 'application/json',
        },
      });
      if (response.ok) {
        const data = (await response.json()) as {
          projects: Array<{ name: string; id: string }>;
        };
        const match = data.projects?.find((project) => project.name === config.project.name);
        if (match) {
          return [
            {
              provider: 'Neon Postgres',
              detail: `project "${config.project.name}" already exists (${match.id})`,
            },
          ];
        }
      }
    } catch {
      logger.warn('  Could not check Neon for existing resources');
    }
    return [];
  },
  buildStep: (context: InfraProviderContext) => ({
    name: 'Neon Postgres',
    enabled: setupNeonProvider.isEnabled(context),
    enabledReason: setupNeonProvider.disabledReason(context),
    instructions: [
      `Will provision a Neon project named "${context.config.project.name}" in ${context.config.providers.neon.region}.`,
      `Will create or adopt branches for: ${context.environments.join(', ')}.`,
      'Idempotent: existing projects/branches are adopted, not recreated.',
    ],
    alreadyDone: () =>
      Boolean(context.state.neon?.projectId) &&
      allEnvironmentsHaveBranch(context.environments, context.state),
    alreadyDoneMessage: 'project + all environment branches already in state',
    execute: async () => {
      const result = await provision(
        context.config,
        context.secrets,
        context.state,
        context.environments,
      );
      if (!result.success) throw new Error(result.message);
      context.applyStateUpdates(result.stateUpdates ?? {});
      return result;
    },
    verifyState: () => ({
      ok: Boolean(context.state.neon?.projectId) && Boolean(context.state.neon?.branches),
      message: context.state.neon?.projectId
        ? `project ${context.state.neon.projectId} with ${Object.keys(context.state.neon.branches ?? {}).length} branches`
        : 'no Neon project recorded',
    }),
    verifyLive: async () => {
      const ok = await check(context.state, context.secrets);
      return { ok, message: ok ? 'reachable' : 'unreachable' };
    },
  }),
  check: ({ state, secrets }) => check(state, secrets),
  deleteInstructions: ({ state }) => {
    if (!state.neon?.projectId) return [];
    const resources: Array<{ label: string; identifier: string }> = [
      { label: 'Project', identifier: state.neon.projectId },
    ];
    for (const [environmentName, branch] of Object.entries(state.neon.branches ?? {})) {
      resources.push({
        label: `Branch (${environmentName})`,
        identifier: `${branch.branchId}`,
      });
    }
    return [
      {
        provider: 'Neon Postgres',
        dashboardUrl: `https://console.neon.tech/app/projects/${state.neon.projectId}`,
        steps: [
          'Open the project page above.',
          'Settings → Delete project (deletes all branches in one go), or open Branches and delete individually.',
        ],
        resources,
      },
    ];
  },
};
