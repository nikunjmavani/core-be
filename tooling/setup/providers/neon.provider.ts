import * as logger from '../logger.util.js';
import type { SetupConfig, SetupSecrets, SetupState, ProviderResult } from '../types.js';

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

    // Create branches for remaining environments
    const nonProductionEnvironments = environments.slice(0, -1);

    for (const environmentName of nonProductionEnvironments) {
      if (branches[environmentName]) {
        logger.success(`  Branch "${environmentName}" already exists`);
        continue;
      }

      const branchSpinner = logger.startSpinner(`Creating branch: ${environmentName}...`);

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

      // Get the connection URI for this branch
      let databaseUrl = '';
      if (branchResponse.connection_uris?.[0]) {
        databaseUrl = branchResponse.connection_uris[0].connection_uri;
      } else {
        const connectionResponse = await neonRequest<NeonConnectionUri>(
          apiKey,
          'GET',
          `/projects/${projectId}/connection_uri?branch_id=${branchId}&pooled=true`,
        );
        databaseUrl = connectionResponse.uri;
      }

      branches[environmentName] = { branchId, endpointId, databaseUrl };
      logger.stopSpinner(branchSpinner, `Branch "${environmentName}" created: ${branchId}`);
    }

    // Fetch production connection URI if not yet set
    const productionEnvironment = environments[environments.length - 1];
    if (productionEnvironment && !branches[productionEnvironment]?.databaseUrl) {
      const connectionResponse = await neonRequest<NeonConnectionUri>(
        apiKey,
        'GET',
        `/projects/${projectId}/connection_uri?pooled=true`,
      );
      branches[productionEnvironment] = {
        branchId: 'main',
        endpointId: 'default',
        databaseUrl: connectionResponse.uri,
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

export async function destroy(state: SetupState, secrets: SetupSecrets): Promise<void> {
  if (!state.neon?.projectId) return;

  const spinner = logger.startSpinner(`Deleting Neon project ${state.neon.projectId}...`);
  try {
    await neonRequest(secrets.neon.apiKey, 'DELETE', `/projects/${state.neon.projectId}`);
    logger.stopSpinner(spinner, 'Neon project deleted');
  } catch (deleteError) {
    const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
    logger.stopSpinner(spinner, `Failed to delete Neon project: ${message}`, 'fail');
  }
}

export async function destroyEnvironment(
  environmentName: string,
  state: SetupState,
  secrets: SetupSecrets,
): Promise<void> {
  const branch = state.neon?.branches?.[environmentName];
  if (!branch || !state.neon?.projectId) return;

  const spinner = logger.startSpinner(`Deleting Neon branch "${environmentName}"...`);
  try {
    await neonRequest(
      secrets.neon.apiKey,
      'DELETE',
      `/projects/${state.neon.projectId}/branches/${branch.branchId}`,
    );
    logger.stopSpinner(spinner, `Neon branch "${environmentName}" deleted`);
  } catch (deleteError) {
    const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
    logger.stopSpinner(
      spinner,
      `Failed to delete Neon branch "${environmentName}": ${message}`,
      'fail',
    );
  }
}
