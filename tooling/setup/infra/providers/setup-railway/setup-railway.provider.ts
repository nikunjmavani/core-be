import * as logger from '@tooling/setup/common/logger.js';
import { isSecretFilled } from '@tooling/setup/common/secrets.js';
import type {
  SetupConfig,
  SetupState,
  ProviderResult,
  InfraProvider,
  InfraProviderContext,
} from '@tooling/setup/common/types.js';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

/**
 * Auth mode for a single Railway GraphQL request.
 *
 * - **bearer**: account / personal access token (`RAILWAY_API_TOKEN`). Required for
 *   project lifecycle (create project, list user projects, create environments, mint
 *   per-environment project tokens via `projectTokenCreate`). Bearer auth is also
 *   accepted on most read paths.
 * - **project**: project-scoped token (`RAILWAY_TOKEN`). Sent as `Project-Access-Token`.
 *   Limited to operations on the single environment the token was minted for.
 */
type RailwayAuthMode = 'bearer' | 'project';

async function railwayGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>,
  authMode: RailwayAuthMode = 'bearer',
): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: {
      ...(authMode === 'project'
        ? { 'Project-Access-Token': token }
        : { Authorization: `Bearer ${token}` }),
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

async function findExistingProjectId(
  token: string,
  projectName: string,
  authMode: RailwayAuthMode,
): Promise<string | undefined> {
  // `projects` (the user-scoped collection) is only readable from a Bearer (account)
  // token — a project token returns an empty list, which would silently make us create
  // a duplicate project. Skip the call when only the project token is available; the
  // caller will fall back to the project id already in setup state.
  if (authMode !== 'bearer') return undefined;
  const result = await railwayGraphQL<{
    projects?: { edges?: Array<{ node?: { id: string; name: string } }> };
  }>(
    token,
    `
    query {
      projects {
        edges {
          node {
            id
            name
          }
        }
      }
    }
  `,
    undefined,
    authMode,
  );
  return result.projects?.edges
    ?.map((edge) => edge.node)
    .find((project) => project?.name === projectName)?.id;
}

interface RailwayProjectDetails {
  environments: Array<{
    id: string;
    name: string;
    serviceInstances: Array<{ serviceId: string; serviceName: string }>;
  }>;
  services: Array<{ id: string; name: string }>;
}

async function fetchProjectDetails(
  token: string,
  projectId: string,
  authMode: RailwayAuthMode,
): Promise<RailwayProjectDetails> {
  const result = await railwayGraphQL<{
    project?: {
      environments?: {
        edges?: Array<{
          node?: {
            id: string;
            name: string;
            serviceInstances?: {
              edges?: Array<{ node?: { serviceId: string; serviceName: string } }>;
            };
          };
        }>;
      };
      services?: {
        edges?: Array<{ node?: { id: string; name: string } }>;
      };
    };
  }>(
    token,
    `
    query($id: String!) {
      project(id: $id) {
        environments {
          edges {
            node {
              id
              name
              serviceInstances {
                edges {
                  node {
                    serviceId
                    serviceName
                  }
                }
              }
            }
          }
        }
        services {
          edges {
            node {
              id
              name
            }
          }
        }
      }
    }
  `,
    { id: projectId },
    authMode,
  );

  const environments = (result.project?.environments?.edges ?? [])
    .map((edge) => edge.node)
    .filter((node): node is NonNullable<typeof node> => node !== undefined)
    .map((node) => ({
      id: node.id,
      name: node.name,
      serviceInstances: (node.serviceInstances?.edges ?? [])
        .map((serviceEdge) => serviceEdge.node)
        .filter(
          (serviceNode): serviceNode is NonNullable<typeof serviceNode> =>
            serviceNode !== undefined,
        )
        .map((serviceNode) => ({
          serviceId: serviceNode.serviceId,
          serviceName: serviceNode.serviceName,
        })),
    }));

  const services = (result.project?.services?.edges ?? [])
    .map((edge) => edge.node)
    .filter((node): node is NonNullable<typeof node> => node !== undefined);

  return { environments, services };
}

async function stageAndCommitServiceAttachments(
  token: string,
  environmentId: string,
  serviceIds: string[],
  commitMessage: string,
  authMode: RailwayAuthMode,
): Promise<void> {
  if (serviceIds.length === 0) return;

  const stagePayload = {
    services: Object.fromEntries(serviceIds.map((serviceId) => [serviceId, { isCreated: true }])),
  };

  await railwayGraphQL<{ environmentStageChanges: { id: string; status: string } }>(
    token,
    `
    mutation($environmentId: String!, $input: EnvironmentConfig!, $merge: Boolean) {
      environmentStageChanges(environmentId: $environmentId, input: $input, merge: $merge) {
        id
        status
      }
    }
  `,
    { environmentId, input: stagePayload, merge: true },
    authMode,
  );

  await railwayGraphQL<{ environmentPatchCommitStaged: string }>(
    token,
    `
    mutation($environmentId: String!, $commitMessage: String, $skipDeploys: Boolean) {
      environmentPatchCommitStaged(
        environmentId: $environmentId
        commitMessage: $commitMessage
        skipDeploys: $skipDeploys
      )
    }
  `,
    { environmentId, commitMessage, skipDeploys: true },
    authMode,
  );
}

/**
 * Mint a single project-scoped Railway token bound to one environment.
 *
 * Requires an account / personal access token (Bearer auth) — `projectTokenCreate`
 * is not callable from a project-scoped token. Persisted into
 * `state.railway.environmentTokens[<env>]` and written by `exportEnvFiles` to each
 * `.env.<env>` as `RAILWAY_TOKEN`. Re-mint via `projectTokenCreate` if the persisted
 * token gets rotated or revoked on Railway's side; calls to other Railway endpoints
 * with a revoked token fail with `Not Authorized`.
 */
async function mintProjectToken(options: {
  apiToken: string;
  projectId: string;
  environmentId: string;
  name: string;
}): Promise<string> {
  const result = await railwayGraphQL<{
    projectTokenCreate: string;
  }>(
    options.apiToken,
    `
    mutation($input: ProjectTokenCreateInput!) {
      projectTokenCreate(input: $input)
    }
  `,
    {
      input: {
        projectId: options.projectId,
        environmentId: options.environmentId,
        name: options.name,
      },
    },
    'bearer',
  );
  if (!result.projectTokenCreate) {
    throw new Error(
      `projectTokenCreate returned an empty token for environment ${options.environmentId}.`,
    );
  }
  return result.projectTokenCreate;
}

/**
 * Services this provider creates as blank shells (image is set later by the
 * application deploy pipeline). The `redis` service is intentionally **not**
 * listed here — it is provisioned by the Railway Redis provider via Railway's
 * `redis` database template (`templateDeployV2`), which creates the service,
 * volume, and `REDIS_PASSWORD` with managed defaults instead of a hand-pinned
 * image and start command.
 */
export const RAILWAY_SERVICE_NAMES = ['api', 'worker'];

function formatRailwayEnvironmentPlan(config: SetupConfig): string {
  return config.environments
    .map(
      (environment) =>
        `${environment.name} (${environment.label}; branch ${environment.branch}; services: ${RAILWAY_SERVICE_NAMES.join(', ')})`,
    )
    .join(', ');
}

export async function provision(
  config: SetupConfig,
  secrets: { railway: { token: string; apiToken?: string | undefined } },
  state: SetupState,
  environments: string[],
): Promise<ProviderResult> {
  // Prefer the account / personal access token (RAILWAY_API_TOKEN) for setup-time
  // operations — it has full project lifecycle access and is required for cross-
  // environment work like `projectTokenCreate`. Fall back to the single project
  // token (RAILWAY_TOKEN) for environments that already have everything provisioned;
  // it will work for read-only `check()` calls and for provisioning the one
  // environment it is scoped to, but cannot mint per-environment tokens.
  const apiToken = secrets.railway.apiToken?.trim();
  const projectToken = secrets.railway.token?.trim();
  const setupToken = apiToken || projectToken;
  const setupAuthMode: RailwayAuthMode = apiToken ? 'bearer' : 'project';
  const projectName = config.project.name;

  if (!setupToken) {
    return { success: true, message: 'Railway: skipped (no token)' };
  }
  if (!apiToken) {
    logger.warn(
      '  RAILWAY_API_TOKEN not set; using RAILWAY_TOKEN (project-scoped) for setup. ' +
        'Cross-environment operations (project create, per-environment token minting) will be skipped.',
    );
  }

  const spinner = logger.startSpinner('Setting up Railway project...');

  try {
    let projectId = state.railway?.projectId;
    const services = state.railway?.services ? { ...state.railway.services } : {};
    const railwayEnvironments = state.railway?.environments
      ? { ...state.railway.environments }
      : {};

    // Adopt remote project by name when local state is missing the project ID.
    if (!projectId) {
      const existingProjectId = await findExistingProjectId(setupToken, projectName, setupAuthMode);
      if (existingProjectId) {
        projectId = existingProjectId;
        logger.stopSpinner(spinner, `Railway project adopted: ${projectId}`);
      }
    }

    // Create project if needed
    if (!projectId) {
      if (setupAuthMode !== 'bearer') {
        throw new Error(
          'Cannot create a new Railway project without RAILWAY_API_TOKEN — projectCreate is not callable from a project-scoped token. Set RAILWAY_API_TOKEN in .env.setup and re-run.',
        );
      }
      const createProjectResult = await railwayGraphQL<{
        projectCreate: { id: string; name: string };
      }>(
        setupToken,
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
        setupAuthMode,
      );

      projectId = createProjectResult.projectCreate.id;
      logger.stopSpinner(spinner, `Railway project created: ${projectId}`);
    } else {
      logger.stopSpinner(spinner, `Railway project already exists: ${projectId}`);
    }

    if (!projectId) {
      throw new Error('Railway project id missing after create/adopt step.');
    }

    const railwayProjectId = projectId;
    const projectDetails = await fetchProjectDetails(setupToken, railwayProjectId, setupAuthMode);
    // Railway displays environment/service names with whatever casing the
    // user (or a template) created them with. Our canonical keys
    // (RAILWAY_SERVICE_NAMES, environment.name from setup.config.json) are
    // lowercase, so every name-keyed lookup in this provider normalises both
    // sides to lowercase. Otherwise a remote service called "Api" would miss
    // a lookup for "api" and we'd happily create a duplicate.
    const remoteEnvironmentsByName = new Map(
      projectDetails.environments.map((environment) => [
        environment.name.toLowerCase(),
        environment,
      ]),
    );
    const remoteServicesByName = new Map(
      projectDetails.services.map((service) => [service.name.toLowerCase(), service.id]),
    );
    logger.info(
      `Railway topology: project "${projectName}" → ${formatRailwayEnvironmentPlan(config)}.`,
    );
    const attachedServicesByEnvironment = new Map<string, Set<string>>(
      projectDetails.environments.map((environment) => [
        environment.id,
        new Set(environment.serviceInstances.map((instance) => instance.serviceId)),
      ]),
    );
    const pendingAttachmentsByEnvironment = new Map<
      string,
      Array<{ serviceName: string; serviceId: string }>
    >();

    for (const environmentName of environments) {
      if (!railwayEnvironments[environmentName]) {
        const remoteEnvironment = remoteEnvironmentsByName.get(environmentName.toLowerCase());
        if (remoteEnvironment) {
          railwayEnvironments[environmentName] = {
            environmentId: remoteEnvironment.id,
            // Normalise service-name keys to lowercase so downstream lookups
            // (`services[serviceName]` where serviceName is a canonical
            // RAILWAY_SERVICE_NAMES entry) hit regardless of how Railway
            // capitalises the live service name.
            services: Object.fromEntries(
              remoteEnvironment.serviceInstances.map((service) => [
                service.serviceName.toLowerCase(),
                { serviceId: service.serviceId, environmentId: remoteEnvironment.id },
              ]),
            ),
          };
          logger.success(`  Environment "${environmentName}" adopted: ${remoteEnvironment.id}`);
        } else {
          const environmentSpinner = logger.startSpinner(
            `Creating Railway environment: ${environmentName}...`,
          );
          if (setupAuthMode !== 'bearer') {
            throw new Error(
              `Cannot create Railway environment "${environmentName}" without RAILWAY_API_TOKEN — environmentCreate is not callable from a project-scoped token. Set RAILWAY_API_TOKEN in .env.setup and re-run.`,
            );
          }
          const createEnvironmentResult = await railwayGraphQL<{
            environmentCreate: { id: string };
          }>(
            setupToken,
            `
            mutation($input: EnvironmentCreateInput!) {
              environmentCreate(input: $input) {
                id
              }
            }
          `,
            { input: { projectId: railwayProjectId, name: environmentName } },
            setupAuthMode,
          );
          const environmentId = createEnvironmentResult.environmentCreate.id;
          railwayEnvironments[environmentName] = { environmentId, services: {} };
          logger.stopSpinner(
            environmentSpinner,
            `Environment "${environmentName}" created: ${environmentId}`,
          );
        }
      }

      const environmentId = railwayEnvironments[environmentName].environmentId;

      for (const serviceName of RAILWAY_SERVICE_NAMES) {
        const lookupKey = serviceName.toLowerCase();
        let serviceId = railwayEnvironments[environmentName].services[serviceName]?.serviceId;

        if (!serviceId) {
          const existingServiceId = remoteServicesByName.get(lookupKey);
          if (existingServiceId) {
            serviceId = existingServiceId;
            logger.success(`  Service "${serviceName}" (${environmentName}) adopted: ${serviceId}`);
          } else {
            const serviceSpinner = logger.startSpinner(
              `Creating Railway service: ${serviceName}...`,
            );
            const createServiceResult = await railwayGraphQL<{
              serviceCreate: { id: string };
            }>(
              setupToken,
              `
              mutation($input: ServiceCreateInput!) {
                serviceCreate(input: $input) {
                  id
                }
              }
            `,
              { input: { projectId: railwayProjectId, name: serviceName } },
              setupAuthMode,
            );
            serviceId = createServiceResult.serviceCreate.id;
            remoteServicesByName.set(lookupKey, serviceId);
            logger.stopSpinner(serviceSpinner, `Service "${serviceName}" created: ${serviceId}`);
          }

          railwayEnvironments[environmentName].services[serviceName] = {
            serviceId,
            environmentId,
          };
        }

        services[serviceName] = { serviceId };

        const attached = attachedServicesByEnvironment.get(environmentId) ?? new Set<string>();
        if (!attached.has(serviceId)) {
          pendingAttachmentsByEnvironment.set(environmentId, [
            ...(pendingAttachmentsByEnvironment.get(environmentId) ?? []),
            { serviceName, serviceId },
          ]);
        }
      }
    }

    for (const [environmentId, pendingServices] of pendingAttachmentsByEnvironment) {
      if (pendingServices.length === 0) continue;
      const environmentName =
        Object.entries(railwayEnvironments).find(
          ([, value]) => value.environmentId === environmentId,
        )?.[0] ?? environmentId;
      const attachSpinner = logger.startSpinner(
        `Attaching ${pendingServices.map((service) => `"${service.serviceName}"`).join(', ')} to environment "${environmentName}"...`,
      );
      await stageAndCommitServiceAttachments(
        setupToken,
        environmentId,
        pendingServices.map((service) => service.serviceId),
        `setup:infra - attach ${pendingServices.map((service) => service.serviceName).join(', ')} to ${environmentName}`,
        setupAuthMode,
      );
      logger.stopSpinner(
        attachSpinner,
        `Attached ${pendingServices.length} service(s) to environment "${environmentName}"`,
      );
    }

    // Mint a per-environment project token for every configured environment.
    // Idempotent across re-runs: token persisted in state is reused unless missing.
    // Only possible with the account token — project tokens can't call projectTokenCreate.
    const environmentTokens: Record<string, string> = state.railway?.environmentTokens
      ? { ...state.railway.environmentTokens }
      : {};
    if (apiToken) {
      for (const environmentName of environments) {
        if (environmentTokens[environmentName]) {
          logger.success(
            `  Per-env Railway project token for "${environmentName}" already in state`,
          );
          continue;
        }
        const environmentId = railwayEnvironments[environmentName]?.environmentId;
        if (!environmentId) {
          logger.warn(
            `  Skipping per-env token mint for "${environmentName}" — environmentId not resolved.`,
          );
          continue;
        }
        const mintSpinner = logger.startSpinner(
          `Minting Railway project token for environment "${environmentName}"...`,
        );
        try {
          const newToken = await mintProjectToken({
            apiToken,
            projectId: railwayProjectId,
            environmentId,
            name: `${projectName}-${environmentName}-setup-infra`,
          });
          environmentTokens[environmentName] = newToken;
          logger.stopSpinner(
            mintSpinner,
            `Minted Railway project token for "${environmentName}" (persisted in state)`,
          );
        } catch (mintError) {
          const message = mintError instanceof Error ? mintError.message : String(mintError);
          logger.stopSpinner(
            mintSpinner,
            `Could not mint Railway project token for "${environmentName}": ${message}`,
            'fail',
          );
        }
      }
    } else {
      logger.warn(
        '  Per-environment Railway project tokens not minted (RAILWAY_API_TOKEN not set). ' +
          'Every .env.<env> will receive the single RAILWAY_TOKEN fallback, which only authenticates for one environment.',
      );
    }

    return {
      success: true,
      message: `Railway: ${Object.keys(railwayEnvironments).length} environments ready`,
      stateUpdates: {
        railway: {
          version: 2,
          projectId: railwayProjectId,
          services,
          environments: railwayEnvironments,
          ...(Object.keys(environmentTokens).length > 0 ? { environmentTokens } : {}),
        },
      },
    };
  } catch (provisionError) {
    const message =
      provisionError instanceof Error ? provisionError.message : String(provisionError);
    logger.error(`Railway provisioning failed: ${message}`);
    return { success: false, message };
  }
}

export async function check(
  state: SetupState,
  secrets: { railway: { token: string; apiToken?: string | undefined } },
): Promise<boolean> {
  if (!state.railway?.projectId) {
    logger.error('Railway: no project in state');
    return false;
  }
  const apiToken = secrets.railway.apiToken?.trim();
  const projectToken = secrets.railway.token?.trim();
  const checkToken = apiToken || projectToken;
  const checkAuthMode: RailwayAuthMode = apiToken ? 'bearer' : 'project';
  if (!checkToken) {
    logger.error('Railway: no token available (set RAILWAY_API_TOKEN or RAILWAY_TOKEN)');
    return false;
  }

  try {
    await railwayGraphQL(
      checkToken,
      `
      query($id: String!) {
        project(id: $id) {
          id
          name
        }
      }
    `,
      { id: state.railway.projectId },
      checkAuthMode,
    );

    logger.success(`Railway project ${state.railway.projectId} — reachable`);
    return true;
  } catch {
    logger.error(`Railway project ${state.railway.projectId} — unreachable`);
    return false;
  }
}

function railwayAlreadyProvisioned(
  state: SetupState,
  environments: string[],
  hasApiToken: boolean,
): boolean {
  if (!state.railway?.projectId) return false;
  const railwayEnvironments = state.railway.environments ?? {};
  const environmentTokens = state.railway.environmentTokens ?? {};
  return environments.every((environmentName) => {
    const environment = railwayEnvironments[environmentName];
    if (!environment) return false;
    const servicesAttached = RAILWAY_SERVICE_NAMES.every((serviceName) =>
      Boolean(environment.services[serviceName]?.serviceId),
    );
    if (!servicesAttached) return false;
    // When RAILWAY_API_TOKEN is available, also require that a per-environment project
    // token has been minted and persisted — otherwise the step would short-circuit and
    // .env.<env> would silently keep the dev-scoped fallback. The single-token fallback
    // mode (no apiToken) intentionally does not require env tokens since they cannot be
    // minted on that path.
    if (hasApiToken && !environmentTokens[environmentName]) return false;
    return true;
  });
}

export const setupRailwayProvider: InfraProvider = {
  key: 'railway',
  name: 'Railway',
  isEnabled: ({ config, secrets }) =>
    config.providers.railway.enabled &&
    (isSecretFilled(secrets.railway.apiToken) || isSecretFilled(secrets.railway.token)),
  disabledReason: ({ config }) =>
    !config.providers.railway.enabled
      ? 'disabled in setup.config.json'
      : 'RAILWAY_API_TOKEN (preferred) or RAILWAY_TOKEN missing in .env.setup',
  preview: ({ config }) =>
    config.providers.railway.enabled
      ? {
          detail:
            'RAILWAY_API_TOKEN (account token, preferred) or RAILWAY_TOKEN (project, fallback)',
          url: 'https://railway.com/account/tokens',
          configKey: 'RAILWAY_API_TOKEN',
        }
      : null,
  settingsReview: ({ config, environments }) =>
    config.providers.railway.enabled
      ? [
          {
            bucket: 'resource',
            provider: 'Railway',
            detail: `project "${config.project.name}" + ${environments.length} environments + services ${RAILWAY_SERVICE_NAMES.join(', ')} attached to each environment`,
          },
        ]
      : [],
  buildStep: (context: InfraProviderContext) => ({
    name: 'Railway',
    enabled: setupRailwayProvider.isEnabled(context),
    enabledReason: setupRailwayProvider.disabledReason(context),
    instructions: [
      `Will create or adopt the Railway project "${context.config.project.name}".`,
      `Will create or adopt Railway environments: ${formatRailwayEnvironmentPlan(context.config)}.`,
      'Will create or adopt project-level services: api, worker (redis is provisioned separately via the Railway Redis template).',
      'Will attach api + worker to every Railway environment via staged-changes.',
    ],
    alreadyDone: () =>
      railwayAlreadyProvisioned(
        context.state,
        context.environments,
        Boolean(context.secrets.railway.apiToken?.trim()),
      ),
    alreadyDoneMessage:
      'project + environments + api/worker attachments + per-env tokens already in state',
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
      ok: Boolean(context.state.railway?.projectId),
      message: context.state.railway?.projectId
        ? `project ${context.state.railway.projectId} with ${Object.keys(context.state.railway.environments ?? {}).length} environments`
        : 'no Railway project recorded',
    }),
    verifyLive: async () => {
      const ok = await check(context.state, context.secrets);
      return { ok, message: ok ? 'reachable' : 'unreachable' };
    },
  }),
  check: ({ state, secrets }) => check(state, secrets),
  deleteInstructions: ({ state }) => {
    if (!state.railway?.projectId) return [];
    const resources: Array<{ label: string; identifier: string }> = [
      { label: 'Project', identifier: state.railway.projectId },
    ];
    for (const [environmentName, environmentState] of Object.entries(
      state.railway.environments ?? {},
    )) {
      resources.push({
        label: `Environment (${environmentName})`,
        identifier: environmentState.environmentId,
      });
      for (const serviceName of RAILWAY_SERVICE_NAMES) {
        const serviceState = environmentState.services[serviceName];
        if (serviceState?.serviceId) {
          resources.push({
            label: `  ${serviceName} service (${environmentName})`,
            identifier: serviceState.serviceId,
          });
        }
      }
    }
    return [
      {
        provider: 'Railway',
        dashboardUrl: `https://railway.app/project/${state.railway.projectId}`,
        steps: [
          'Open the project page above.',
          'Settings → Danger → Delete project (removes all environments + services), or open each service and use Settings → Delete service.',
        ],
        resources,
      },
    ];
  },
};
