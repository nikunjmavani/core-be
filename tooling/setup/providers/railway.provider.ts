import * as logger from '../logger.util.js';
import type { SetupConfig, SetupState, ProviderResult } from '../types.js';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

async function railwayGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Railway GraphQL failed (${response.status}): ${errorBody}`);
  }

  const result = (await response.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (result.errors?.length) {
    throw new Error(
      `Railway GraphQL errors: ${result.errors.map((error) => error.message).join(', ')}`,
    );
  }

  return result.data as T;
}

export async function provision(
  config: SetupConfig,
  secrets: { railway: { token: string } },
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  const token = secrets.railway.token;
  const projectName = config.project.name;

  if (!token) {
    return { success: true, message: 'Railway: skipped (no token)' };
  }

  const spinner = logger.startSpinner('Setting up Railway project...');

  try {
    let projectId = state.railway?.projectId;
    const services: Record<string, { serviceId: string; environmentId?: string; url?: string }> =
      state.railway?.services ? { ...state.railway.services } : {};

    // Create project if needed
    if (!projectId) {
      const createProjectResult = await railwayGraphQL<{
        projectCreate: { id: string; name: string };
      }>(
        token,
        `
        mutation($input: ProjectCreateInput!) {
          projectCreate(input: $input) {
            id
            name
          }
        }
      `,
        {
          input: { name: projectName },
        },
      );

      projectId = createProjectResult.projectCreate.id;
      logger.stopSpinner(spinner, `Railway project created: ${projectId}`);
    } else {
      logger.stopSpinner(spinner, `Railway project already exists: ${projectId}`);
    }

    // Create service per environment
    for (const environmentName of environments) {
      if (services[environmentName]) {
        logger.success(`  Service "${environmentName}" already exists`);
        continue;
      }

      const serviceSpinner = logger.startSpinner(
        `Creating Railway service: ${projectName}-${environmentName}...`,
      );

      const createServiceResult = await railwayGraphQL<{
        serviceCreate: { id: string };
      }>(
        token,
        `
        mutation($input: ServiceCreateInput!) {
          serviceCreate(input: $input) {
            id
          }
        }
      `,
        {
          input: {
            projectId,
            name: `${projectName}-${environmentName}`,
          },
        },
      );

      const serviceId = createServiceResult.serviceCreate.id;
      services[environmentName] = { serviceId };

      logger.stopSpinner(serviceSpinner, `Service "${environmentName}" created: ${serviceId}`);
    }

    return {
      success: true,
      message: `Railway: ${Object.keys(services).length} services ready`,
      stateUpdates: { railway: { projectId: projectId!, services } },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`Railway provisioning failed: ${message}`);
    return { success: false, message };
  }
}

export async function check(state: SetupState, token: string): Promise<boolean> {
  if (!state.railway?.projectId) {
    logger.error('Railway: no project in state');
    return false;
  }

  try {
    await railwayGraphQL(
      token,
      `
      query($id: String!) {
        project(id: $id) {
          id
          name
        }
      }
    `,
      { id: state.railway.projectId },
    );

    logger.success(`Railway project ${state.railway.projectId} — reachable`);
    return true;
  } catch {
    logger.error(`Railway project ${state.railway.projectId} — unreachable`);
    return false;
  }
}

export async function destroy(state: SetupState, token: string): Promise<void> {
  if (!state.railway?.projectId) return;

  const spinner = logger.startSpinner(`Deleting Railway project ${state.railway.projectId}...`);
  try {
    await railwayGraphQL(
      token,
      `
      mutation($id: String!) {
        projectDelete(id: $id)
      }
    `,
      { id: state.railway.projectId },
    );
    logger.stopSpinner(spinner, 'Railway project deleted');
  } catch (deleteError) {
    const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
    logger.stopSpinner(spinner, `Failed to delete Railway project: ${message}`, 'fail');
  }
}

export async function destroyEnvironment(
  environmentName: string,
  state: SetupState,
  token: string,
): Promise<void> {
  const service = state.railway?.services?.[environmentName];
  if (!service?.serviceId) return;

  const spinner = logger.startSpinner(`Deleting Railway service "${environmentName}"...`);
  try {
    await railwayGraphQL(
      token,
      `
      mutation($id: String!) {
        serviceDelete(id: $id)
      }
    `,
      { id: service.serviceId },
    );
    logger.stopSpinner(spinner, `Railway service "${environmentName}" deleted`);
  } catch (deleteError) {
    const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
    logger.stopSpinner(
      spinner,
      `Failed to delete Railway service "${environmentName}": ${message}`,
      'fail',
    );
  }
}
