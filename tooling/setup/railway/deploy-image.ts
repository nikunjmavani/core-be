/**
 * Railway image-deploy CLI.
 *
 * Pins a Railway service to a freshly built container image and triggers a
 * brand-new deployment from that image. Used by `.github/workflows/
 * reusable-railway-deploy.yml` to deploy the GHCR image that
 * reusable-docker-build-trivy.yml just built, Trivy-scanned, and pushed.
 *
 * Why not the Railway CLI?
 *   `railway redeploy` re-runs the service's previous deployment object with
 *   its existing image tag (community thread "deploy docker tag from CI"
 *   confirms `serviceInstanceRedeploy` ignores configuration changes made
 *   between deployments, and the CLI does not expose `--image`). `railway up`
 *   uploads source from the runner and lets Railway build it — that bypasses
 *   the scanned GHCR image entirely. The only reliable way to deploy a new
 *   image tag is the Railway GraphQL API: `serviceInstanceUpdate` to point
 *   the service at the new image, then `serviceInstanceDeployV2` to create a
 *   fresh deployment from the updated configuration.
 *
 * Flow:
 *   1. Resolve serviceId → projectId via `service(id)` query.
 *   2. List the project's environments and pick the one whose name matches
 *      `--environment-name` (defaults to `process.env.ENVIRONMENT`,
 *      e.g. `development` / `production`). The reusable workflow sets that
 *      env var from the resolved GitHub Environment.
 *   3. `serviceInstanceUpdate` with `{ source: { image } }` — works whether
 *      the service was previously image-sourced, repo-sourced, or brand new
 *      with no source at all (so this single path replaces both the
 *      `railway redeploy` steady state and the `railway up` bootstrap).
 *   4. `serviceInstanceDeployV2(serviceId, environmentId)` → deploymentId.
 *   5. Poll `deployment(id)` until a terminal status. Surface failures with
 *      non-zero exit so the GitHub Actions step fails loudly instead of
 *      reporting success while Railway is still building (or has crashed).
 *
 * Inputs (all CLI flags):
 *   --service <id>                Railway service id (required).
 *   --image <ref>                 Container image, e.g.
 *                                 ghcr.io/owner/repo/core-be-api:<sha> or
 *                                 ghcr.io/owner/repo/core-be-api@sha256:...
 *                                 (required).
 *   --label <name>                Human label for log lines (default: service id).
 *   --environment-name <name>     Railway environment name to deploy into.
 *                                 Defaults to process.env.ENVIRONMENT.
 *   --environment-id <id>         Skip the name lookup and use this id directly.
 *   --timeout-seconds <n>         How long to poll for terminal status
 *                                 (default 900 = 15m; covers cold builds).
 *   --poll-interval-seconds <n>   Poll cadence (default 5s).
 *   --skip-wait                   Fire-and-forget mode for diagnostics; the
 *                                 workflow should NEVER pass this so deploy
 *                                 failures actually fail the job.
 *
 * Environment:
 *   RAILWAY_TOKEN                 Railway project token (required). Inherited
 *                                 from the GitHub Environment in CI.
 *   ENVIRONMENT                   GitHub Environment name (development /
 *                                 production); used as the default for
 *                                 --environment-name.
 *
 * Exit codes:
 *   0   Deployment reached SUCCESS within the timeout (or --skip-wait was set).
 *   1   Any validation, GraphQL, polling, or terminal-failure error.
 */
import { parseArgs } from 'node:util';
import * as logger from '../common/logger.js';

const RAILWAY_API_URL = 'https://backboard.railway.com/graphql/v2';

const DEPLOYMENT_TERMINAL_STATUSES = new Set([
  'SUCCESS',
  'FAILED',
  'CRASHED',
  'REMOVED',
  'SKIPPED',
]);

const DEPLOYMENT_SUCCESS_STATUS = 'SUCCESS';

interface RailwayDeployImageOptions {
  serviceId: string;
  image: string;
  label: string;
  environmentName: string | null;
  environmentId: string | null;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
  skipWait: boolean;
}

interface RailwayService {
  id: string;
  name: string;
  projectId: string;
}

interface RailwayEnvironment {
  id: string;
  name: string;
}

interface RailwayDeployment {
  id: string;
  status: string;
  staticUrl?: string | null;
  url?: string | null;
}

async function railwayGraphQL<T>({
  token,
  query,
  variables,
}: {
  token: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const response = await fetch(RAILWAY_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Railway GraphQL HTTP ${response.status}: ${body}`);
  }

  const result = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (result.errors?.length) {
    throw new Error(
      `Railway GraphQL errors: ${result.errors.map((entry) => entry.message).join('; ')}`,
    );
  }

  if (result.data === undefined) {
    throw new Error('Railway GraphQL returned no data and no errors.');
  }

  return result.data;
}

async function fetchService({
  token,
  serviceId,
}: {
  token: string;
  serviceId: string;
}): Promise<RailwayService> {
  const result = await railwayGraphQL<{
    service: { id: string; name: string; projectId: string } | null;
  }>({
    token,
    query: `
      query($serviceId: String!) {
        service(id: $serviceId) {
          id
          name
          projectId
        }
      }
    `,
    variables: { serviceId },
  });

  if (!result.service) {
    throw new Error(`Railway service ${serviceId} not found (or token lacks access).`);
  }
  return result.service;
}

async function resolveEnvironmentId({
  token,
  projectId,
  environmentName,
  serviceLabel,
}: {
  token: string;
  projectId: string;
  environmentName: string;
  serviceLabel: string;
}): Promise<string> {
  const result = await railwayGraphQL<{
    project: { environments: { edges: Array<{ node: RailwayEnvironment }> } } | null;
  }>({
    token,
    query: `
      query($projectId: String!) {
        project(id: $projectId) {
          environments {
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
    variables: { projectId },
  });

  if (!result.project) {
    throw new Error(`Railway project ${projectId} not found while resolving ${serviceLabel}.`);
  }

  const environments = result.project.environments.edges.map((edge) => edge.node);
  const match = environments.find(
    (environment) => environment.name.toLowerCase() === environmentName.toLowerCase(),
  );

  if (!match) {
    const available = environments.map((environment) => environment.name).join(', ');
    throw new Error(
      `No Railway environment named "${environmentName}" in project ${projectId} (${serviceLabel}). Available: ${available}.`,
    );
  }

  return match.id;
}

async function updateServiceImage({
  token,
  serviceId,
  environmentId,
  image,
}: {
  token: string;
  serviceId: string;
  environmentId: string;
  image: string;
}): Promise<void> {
  await railwayGraphQL<{ serviceInstanceUpdate: boolean | null }>({
    token,
    query: `
      mutation($serviceId: String!, $environmentId: String!, $input: ServiceInstanceUpdateInput!) {
        serviceInstanceUpdate(
          serviceId: $serviceId
          environmentId: $environmentId
          input: $input
        )
      }
    `,
    variables: {
      serviceId,
      environmentId,
      input: { source: { image } },
    },
  });
}

async function triggerDeployment({
  token,
  serviceId,
  environmentId,
}: {
  token: string;
  serviceId: string;
  environmentId: string;
}): Promise<string> {
  const result = await railwayGraphQL<{ serviceInstanceDeployV2: string }>({
    token,
    query: `
      mutation($serviceId: String!, $environmentId: String!) {
        serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId)
      }
    `,
    variables: { serviceId, environmentId },
  });

  if (!result.serviceInstanceDeployV2) {
    throw new Error('serviceInstanceDeployV2 returned no deployment id.');
  }
  return result.serviceInstanceDeployV2;
}

async function fetchDeployment({
  token,
  deploymentId,
}: {
  token: string;
  deploymentId: string;
}): Promise<RailwayDeployment> {
  const result = await railwayGraphQL<{ deployment: RailwayDeployment | null }>({
    token,
    query: `
      query($deploymentId: String!) {
        deployment(id: $deploymentId) {
          id
          status
          staticUrl
          url
        }
      }
    `,
    variables: { deploymentId },
  });

  if (!result.deployment) {
    throw new Error(`Railway deployment ${deploymentId} not found.`);
  }
  return result.deployment;
}

async function waitForTerminalStatus({
  token,
  deploymentId,
  label,
  timeoutSeconds,
  pollIntervalSeconds,
}: {
  token: string;
  deploymentId: string;
  label: string;
  timeoutSeconds: number;
  pollIntervalSeconds: number;
}): Promise<RailwayDeployment> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  let lastStatus = '';
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    let deployment: RailwayDeployment;
    try {
      deployment = await fetchDeployment({ token, deploymentId });
    } catch (error) {
      // Railway occasionally returns transient 5xx during deploys. Don't
      // fail the whole job on a single blip — log and keep polling until
      // the timeout. This mirrors the retry behaviour already used by the
      // workflow's variables push.
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`  ${label}: poll attempt ${attempt} errored (${message}); retrying.`);
      await sleep(pollIntervalSeconds * 1000);
      continue;
    }

    if (deployment.status !== lastStatus) {
      logger.info(`  ${label}: deployment ${deployment.id} → ${deployment.status}`);
      lastStatus = deployment.status;
    }

    if (DEPLOYMENT_TERMINAL_STATUSES.has(deployment.status)) {
      return deployment;
    }

    await sleep(pollIntervalSeconds * 1000);
  }

  throw new Error(
    `Timeout: deployment ${deploymentId} for ${label} did not reach a terminal status within ${timeoutSeconds}s (last status: ${lastStatus || 'unknown'}).`,
  );
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function parseOptions(): RailwayDeployImageOptions {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      service: { type: 'string' },
      image: { type: 'string' },
      label: { type: 'string' },
      'environment-name': { type: 'string' },
      'environment-id': { type: 'string' },
      'timeout-seconds': { type: 'string' },
      'poll-interval-seconds': { type: 'string' },
      'skip-wait': { type: 'boolean', default: false },
    },
    allowPositionals: false,
    strict: true,
  });

  const serviceId = (values.service ?? '').trim();
  const image = (values.image ?? '').trim();
  const environmentNameInput = (values['environment-name'] ?? process.env.ENVIRONMENT ?? '').trim();
  const environmentId = (values['environment-id'] ?? '').trim();
  const label = (values.label ?? serviceId).trim();
  const timeoutSeconds = Number.parseInt(values['timeout-seconds'] ?? '900', 10);
  const pollIntervalSeconds = Number.parseInt(values['poll-interval-seconds'] ?? '5', 10);

  if (!serviceId) throw new Error('--service <id> is required.');
  if (!image) throw new Error('--image <ref> is required.');
  if (!(environmentId || environmentNameInput)) {
    throw new Error(
      'Either --environment-id or --environment-name (or process.env.ENVIRONMENT) is required.',
    );
  }
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new Error(`Invalid --timeout-seconds: ${values['timeout-seconds']}`);
  }
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds <= 0) {
    throw new Error(`Invalid --poll-interval-seconds: ${values['poll-interval-seconds']}`);
  }

  return {
    serviceId,
    image,
    label,
    environmentName: environmentNameInput || null,
    environmentId: environmentId || null,
    timeoutSeconds,
    pollIntervalSeconds,
    skipWait: values['skip-wait'] === true,
  };
}

async function main(): Promise<void> {
  const options = parseOptions();
  const token = (process.env.RAILWAY_TOKEN ?? '').trim();
  if (!token) {
    throw new Error(
      'RAILWAY_TOKEN is not set. Export it from the GitHub Environment before running this tool.',
    );
  }

  logger.info(`Deploy ${options.label}: looking up service ${options.serviceId}.`);
  const service = await fetchService({ token, serviceId: options.serviceId });
  logger.success(`  Service: ${service.name} (id=${service.id}, projectId=${service.projectId})`);

  let environmentId = options.environmentId;
  if (!environmentId) {
    if (!options.environmentName) {
      throw new Error('Internal: environmentName is required when environmentId is unset.');
    }
    logger.info(
      `  Resolving Railway environment "${options.environmentName}" in project ${service.projectId}.`,
    );
    environmentId = await resolveEnvironmentId({
      token,
      projectId: service.projectId,
      environmentName: options.environmentName,
      serviceLabel: options.label,
    });
    logger.success(`  Environment: ${options.environmentName} (id=${environmentId})`);
  } else {
    logger.info(`  Using provided environment id ${environmentId}.`);
  }

  logger.info(`  Pinning service source to image: ${options.image}`);
  await updateServiceImage({
    token,
    serviceId: options.serviceId,
    environmentId,
    image: options.image,
  });
  logger.success('  serviceInstanceUpdate: source.image set.');

  logger.info('  Triggering serviceInstanceDeployV2 to create a fresh deployment.');
  const deploymentId = await triggerDeployment({
    token,
    serviceId: options.serviceId,
    environmentId,
  });
  logger.success(`  Deployment requested. id=${deploymentId}`);

  if (options.skipWait) {
    logger.warn(
      `  --skip-wait set; not polling for terminal status. Deployment ${deploymentId} may still fail asynchronously.`,
    );
    return;
  }

  logger.info(
    `  Waiting for deployment ${deploymentId} to reach a terminal status (timeout ${options.timeoutSeconds}s).`,
  );
  const finalDeployment = await waitForTerminalStatus({
    token,
    deploymentId,
    label: options.label,
    timeoutSeconds: options.timeoutSeconds,
    pollIntervalSeconds: options.pollIntervalSeconds,
  });

  if (finalDeployment.status !== DEPLOYMENT_SUCCESS_STATUS) {
    throw new Error(
      `Deployment ${deploymentId} for ${options.label} ended in non-success status: ${finalDeployment.status}.`,
    );
  }

  const accessUrl = finalDeployment.staticUrl ?? finalDeployment.url ?? '(no public url)';
  logger.success(`  ${options.label}: deployment ${deploymentId} SUCCESS (${accessUrl}).`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  logger.error(message);
  process.exit(1);
});
