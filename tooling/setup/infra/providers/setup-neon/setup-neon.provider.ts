import postgres from 'postgres';
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

/** Postgres schemas owned by core-be migrations. Kept in sync with src/infrastructure/database/pg-schemas.ts. */
const CORE_BE_APP_SCHEMAS = [
  'auth',
  'tenancy',
  'billing',
  'notify',
  'audit',
  'upload',
  'public',
] as const;

const POSTGRES_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/;

/** Resolve the Neon branch name to use for an environment from setup.config.json. */
function getNeonBranchName(config: SetupConfig, environmentName: string): string {
  const environment = config.environments.find((entry) => entry.name === environmentName);
  if (!environment) {
    throw new Error(`Unknown environment "${environmentName}" in setup.config.json`);
  }
  return environment.branch;
}

/** Build the per-environment runtime role name (e.g. development_service_user). */
function getServiceRoleName(environmentName: string): string {
  const candidate = `${environmentName}_service_user`;
  if (!POSTGRES_IDENTIFIER_PATTERN.test(candidate)) {
    throw new Error(
      `Cannot derive Postgres role from environment name "${environmentName}" — expected lowercase letters, digits, underscores.`,
    );
  }
  return candidate;
}

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
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
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
  const match = preferredOrganizationName
    ? organizations.find(
        (org) =>
          org.name?.toLowerCase() === preferredOrganizationName.toLowerCase() ||
          org.id === preferredOrganizationName,
      )
    : undefined;
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

const NEON_OWNER_ROLE = 'neondb_owner';
const NEON_DEFAULT_DATABASE = 'neondb';

interface NeonBranchEntry {
  branchId: string;
  endpointId: string;
  databaseUrl: string;
  databaseMigrationUrl?: string | undefined;
  serviceRoleName?: string | undefined;
}

interface GetConnectionUriOptions {
  apiKey: string;
  projectId: string;
  branchId: string;
  roleName: string;
  pooled: boolean;
}

async function getConnectionUri(options: GetConnectionUriOptions): Promise<string> {
  const connectionResponse = await neonRequest<NeonConnectionUri>(
    options.apiKey,
    'GET',
    `/projects/${options.projectId}/connection_uri`,
    undefined,
    {
      branch_id: options.branchId,
      database_name: NEON_DEFAULT_DATABASE,
      role_name: options.roleName,
      pooled: String(options.pooled),
    },
  );
  return connectionResponse.uri;
}

interface NeonRoleSummary {
  name: string;
  branch_id?: string;
  protected?: boolean;
}

interface NeonRolesListResponse {
  roles: NeonRoleSummary[];
}

interface EnsureRuntimeRoleOptions {
  apiKey: string;
  projectId: string;
  branchId: string;
  roleName: string;
}

/**
 * Ensure a Neon role with the given name exists on the branch. Idempotent: lists
 * roles first and POSTs only if the role is missing. We do not persist the role
 * password because the subsequent `connection_uri` call returns a URI with the
 * password already embedded by Neon.
 */
async function ensureRuntimeRoleExists(options: EnsureRuntimeRoleOptions): Promise<boolean> {
  const { apiKey, projectId, branchId, roleName } = options;
  const listResponse = await neonRequest<NeonRolesListResponse>(
    apiKey,
    'GET',
    `/projects/${projectId}/branches/${branchId}/roles`,
  );
  if (listResponse.roles?.some((role) => role.name === roleName)) {
    return false;
  }
  await neonRequest<unknown>(apiKey, 'POST', `/projects/${projectId}/branches/${branchId}/roles`, {
    role: { name: roleName },
  });
  return true;
}

interface GrantRuntimePrivilegesOptions {
  migrationUrl: string;
  roleName: string;
  environmentName: string;
}

/**
 * Connect as `neondb_owner` and grant least-privilege DML access to the runtime
 * role across all core-be application schemas. Tolerant of schemas that don't
 * exist yet (first-time setup before migrations have run) — we list pg_namespace
 * up-front and only grant on schemas that are present.
 */
async function grantRuntimePrivileges(options: GrantRuntimePrivilegesOptions): Promise<string[]> {
  const { migrationUrl, roleName, environmentName } = options;
  if (!POSTGRES_IDENTIFIER_PATTERN.test(roleName)) {
    throw new Error(`Refusing to grant on unsafe role identifier: ${roleName}`);
  }

  const sql = postgres(migrationUrl, { max: 1, prepare: false });
  const grantedSchemas: string[] = [];
  try {
    const existing = await sql<{ nspname: string }[]>`
      SELECT nspname
      FROM pg_namespace
      WHERE nspname = ANY(${[...CORE_BE_APP_SCHEMAS]}::text[])
    `;
    const existingSchemas = new Set(existing.map((row) => row.nspname));

    await sql.unsafe(`GRANT CONNECT ON DATABASE ${NEON_DEFAULT_DATABASE} TO ${roleName}`);

    for (const schema of CORE_BE_APP_SCHEMAS) {
      if (!existingSchemas.has(schema)) continue;
      await sql.unsafe(`GRANT USAGE ON SCHEMA ${schema} TO ${roleName}`);
      await sql.unsafe(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO ${roleName}`,
      );
      await sql.unsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${schema} TO ${roleName}`);
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${NEON_OWNER_ROLE} IN SCHEMA ${schema} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roleName}`,
      );
      await sql.unsafe(
        `ALTER DEFAULT PRIVILEGES FOR ROLE ${NEON_OWNER_ROLE} IN SCHEMA ${schema} GRANT USAGE, SELECT ON SEQUENCES TO ${roleName}`,
      );
      grantedSchemas.push(schema);
    }

    if (grantedSchemas.length === 0) {
      logger.warn(
        `  No core-be schemas present yet on "${environmentName}" — run \`pnpm db:migrate\` and re-run \`pnpm setup:infra\` to grant runtime privileges.`,
      );
    }

    return grantedSchemas;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

interface EnsureBranchRuntimeRoleOptions {
  apiKey: string;
  projectId: string;
  environmentName: string;
  entry: NeonBranchEntry;
}

/**
 * Create (if missing) the per-environment runtime role on a branch, fetch fresh
 * pooled (service-role) and direct (owner) connection URIs, then grant
 * least-privilege access on existing schemas. Returns the updated branch entry.
 */
async function ensureBranchRuntimeRole(
  options: EnsureBranchRuntimeRoleOptions,
): Promise<NeonBranchEntry> {
  const { apiKey, projectId, environmentName, entry } = options;
  const serviceRoleName = getServiceRoleName(environmentName);

  const created = await ensureRuntimeRoleExists({
    apiKey,
    projectId,
    branchId: entry.branchId,
    roleName: serviceRoleName,
  });
  logger.success(
    created
      ? `  Runtime role "${serviceRoleName}" created on Neon branch ${entry.branchId}`
      : `  Runtime role "${serviceRoleName}" already exists on Neon branch ${entry.branchId}`,
  );

  const [databaseUrl, databaseMigrationUrl] = await Promise.all([
    getConnectionUri({
      apiKey,
      projectId,
      branchId: entry.branchId,
      roleName: serviceRoleName,
      pooled: true,
    }),
    getConnectionUri({
      apiKey,
      projectId,
      branchId: entry.branchId,
      roleName: NEON_OWNER_ROLE,
      pooled: false,
    }),
  ]);

  const grantedSchemas = await grantRuntimePrivileges({
    migrationUrl: databaseMigrationUrl,
    roleName: serviceRoleName,
    environmentName,
  });
  if (grantedSchemas.length > 0) {
    logger.success(
      `  Granted runtime privileges to "${serviceRoleName}" on schemas: ${grantedSchemas.join(', ')}`,
    );
  }

  return {
    ...entry,
    databaseUrl,
    databaseMigrationUrl,
    serviceRoleName,
  };
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
    const branches: Record<string, NeonBranchEntry> = state.neon?.branches
      ? { ...state.neon.branches }
      : {};

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

      // The default branch (typically named "main") is used for the last environment
      // (typically prod). The branch id will be resolved below once the project's
      // operations finish — leave it as a placeholder so the post-branch pass can
      // re-fetch a proper URI keyed by the configured branch name.
      const productionEnvironment = environments[environments.length - 1];
      if (productionEnvironment && projectResponse.connection_uris?.[0]) {
        branches[productionEnvironment] = {
          branchId: '',
          endpointId: projectResponse.connection_uris[0].connection_uri ? 'default' : '',
          databaseUrl: projectResponse.connection_uris[0].connection_uri,
        };
      }
    } else {
      logger.stopSpinner(spinner, `Neon project already exists: ${projectId}`);
    }

    if (projectId === undefined) {
      throw new Error(
        'Neon projectId is unset after create/adopt flow (unreachable; both branches assign it).',
      );
    }
    const neonProjectId: string = projectId;

    await waitForOperations(apiKey, neonProjectId);

    const remoteBranches = await listBranches(apiKey, neonProjectId);

    // Create branches for remaining environments
    const nonProductionEnvironments = environments.slice(0, -1);

    for (const environmentName of nonProductionEnvironments) {
      const neonBranchName = getNeonBranchName(config, environmentName);
      const existingEntry = branches[environmentName];
      if (existingEntry?.branchId) {
        logger.success(`  Branch "${environmentName}" (Neon: ${neonBranchName}) already exists`);
        continue;
      }

      const remoteBranch = remoteBranches.find((branch) => branch.name === neonBranchName);
      if (remoteBranch) {
        await waitForOperations(apiKey, neonProjectId);
        const adoptSpinner = logger.startSpinner(
          `Adopting existing Neon branch "${neonBranchName}" for environment "${environmentName}"...`,
        );
        branches[environmentName] = {
          ...(existingEntry ?? {}),
          branchId: remoteBranch.id,
          endpointId: existingEntry?.endpointId ?? '',
          databaseUrl: existingEntry?.databaseUrl ?? '',
        };
        logger.stopSpinner(
          adoptSpinner,
          `Branch "${neonBranchName}" adopted for "${environmentName}": ${remoteBranch.id}`,
        );
        continue;
      }

      const branchSpinner = logger.startSpinner(
        `Creating Neon branch "${neonBranchName}" for environment "${environmentName}"...`,
      );

      await waitForOperations(apiKey, neonProjectId);

      const branchResponse = await neonRequest<NeonBranch>(
        apiKey,
        'POST',
        `/projects/${neonProjectId}/branches`,
        {
          branch: { name: neonBranchName },
          endpoints: [{ type: 'read_write' }],
        },
      );

      const branchId = branchResponse.branch.id;
      const endpointId = branchResponse.endpoints?.[0]?.id ?? '';

      branches[environmentName] = {
        ...(existingEntry ?? {}),
        branchId,
        endpointId,
        databaseUrl: existingEntry?.databaseUrl ?? '',
      };
      logger.stopSpinner(
        branchSpinner,
        `Branch "${neonBranchName}" created for "${environmentName}": ${branchId}`,
      );
    }

    // Resolve production branch — prefer the configured branch name, fall back to
    // Neon's default "main" or the only remaining branch.
    const productionEnvironment = environments[environments.length - 1];
    if (productionEnvironment) {
      const productionBranchName = getNeonBranchName(config, productionEnvironment);
      const existingProductionEntry = branches[productionEnvironment];
      if (!existingProductionEntry?.branchId) {
        const productionBranch =
          remoteBranches.find((branch) => branch.name === productionBranchName) ??
          remoteBranches.find((branch) => branch.name === 'main') ??
          remoteBranches[0];
        if (!productionBranch) {
          throw new Error(
            `Neon project "${neonProjectId}" has no branches; cannot resolve production connection URI.`,
          );
        }
        branches[productionEnvironment] = {
          ...(existingProductionEntry ?? {}),
          branchId: productionBranch.id,
          endpointId: existingProductionEntry?.endpointId ?? 'default',
          databaseUrl: existingProductionEntry?.databaseUrl ?? '',
        };
      }
    }

    // Ensure each environment has a runtime role + populated DATABASE_URL and
    // DATABASE_MIGRATION_URL, then grant least-privilege access on the existing
    // schemas. Idempotent for re-runs.
    for (const environmentName of environments) {
      const entry = branches[environmentName];
      if (!entry?.branchId) {
        throw new Error(
          `Neon branch for environment "${environmentName}" was not resolved; cannot create runtime role.`,
        );
      }
      const updated = await ensureBranchRuntimeRole({
        apiKey,
        projectId: neonProjectId,
        environmentName,
        entry,
      });
      branches[environmentName] = updated;
    }

    return {
      success: true,
      message: `Neon: ${Object.keys(branches).length} branches ready with runtime roles`,
      stateUpdates: { neon: { projectId: neonProjectId, branches } },
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
  return environments.every((environmentName) => {
    const entry = branches[environmentName];
    return Boolean(
      entry?.branchId &&
        entry?.databaseUrl &&
        entry?.databaseMigrationUrl &&
        entry?.serviceRoleName,
    );
  });
}

function countEnvironmentsWithServiceRole(state: SetupState): number {
  const branches = state.neon?.branches;
  if (!branches) return 0;
  return Object.values(branches).filter((entry) => Boolean(entry?.serviceRoleName)).length;
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
    if (!(config.providers.neon.enabled && isSecretFilled(secrets.neon.apiKey))) return [];
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
    alreadyDoneMessage:
      'project + all environment branches (with runtime role + migration URL) already in state',
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
    verifyState: () => {
      const branchCount = Object.keys(context.state.neon?.branches ?? {}).length;
      const withRole = countEnvironmentsWithServiceRole(context.state);
      return {
        ok: Boolean(context.state.neon?.projectId) && Boolean(context.state.neon?.branches),
        message: context.state.neon?.projectId
          ? `project ${context.state.neon.projectId} with ${branchCount} branch(es), ${withRole} with runtime role`
          : 'no Neon project recorded',
      };
    },
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
