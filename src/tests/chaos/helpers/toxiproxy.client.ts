import {
  CHAOS_POSTGRES_PROXY_NAME,
  CHAOS_REDIS_PROXY_NAME,
  DEFAULT_CHAOS_POSTGRES_PROXY_LISTEN_HOST,
  DEFAULT_CHAOS_POSTGRES_PROXY_LISTEN_PORT,
  DEFAULT_CHAOS_REDIS_PROXY_LISTEN_HOST,
  DEFAULT_CHAOS_REDIS_PROXY_LISTEN_PORT,
} from '@/tests/chaos/chaos.constants.js';

const DEFAULT_CHAOS_TESTING_TOXIPROXY_BASE_URL = 'http://127.0.0.1:8474';

interface ToxinDefinitionForChaosListeningProxy {
  name?: string;
  type?: string;
  stream?: string;
  toxicity?: number;
  attributes?: Record<string, number | boolean | string>;
}

function resolveChaosTestingToxiproxyAdministratorBaseUrl(): string {
  const toxiproxyUrl =
    typeof process.env.TOXIPROXY_URL === 'string' && process.env.TOXIPROXY_URL.length > 0
      ? process.env.TOXIPROXY_URL.replace(/\/$/, '')
      : DEFAULT_CHAOS_TESTING_TOXIPROXY_BASE_URL;
  return toxiproxyUrl;
}

async function readJsonFromChaosTestingToxiproxyResponse<ResponseShape>(
  path: string,
  init?: RequestInit,
): Promise<ResponseShape | undefined> {
  const administratorBaseUrl = resolveChaosTestingToxiproxyAdministratorBaseUrl();
  const httpResponse = await fetch(`${administratorBaseUrl}${path}`, init);

  if (!httpResponse.ok) {
    const errorText = await httpResponse.text().catch(() => '');
    throw new Error(
      `chaos_testing.toxiproxy.rest_request.failed (${httpResponse.status}): ${errorText}`,
    );
  }

  const contentLength = httpResponse.headers.get('content-length');
  if (httpResponse.status === 204 || contentLength === '0') {
    return undefined;
  }

  const payloadText = await httpResponse.text();
  if (payloadText.trim().length === 0) {
    return undefined;
  }

  return JSON.parse(payloadText) as ResponseShape;
}

async function invokeChaosTestingToxiproxyExpectingSuccessfulResponse(
  path: string,
  init?: RequestInit,
): Promise<void> {
  const administratorBaseUrl = resolveChaosTestingToxiproxyAdministratorBaseUrl();
  const httpResponse = await fetch(`${administratorBaseUrl}${path}`, init);
  if (!httpResponse.ok) {
    const errorText = await httpResponse.text().catch(() => '');
    throw new Error(
      `chaos_testing.toxiproxy.rest_request.failed (${httpResponse.status}): ${errorText}`,
    );
  }
}

/**
 * Retry until `/version` resolves so intermittent GitHub Actions service startup jitter is tolerated.
 */
export async function waitUntilChaosTestingToxiproxyRestApiAnswers(options?: {
  maxAttempts?: number;
  delayBetweenAttemptsMs?: number;
}): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 60;
  const delayBetweenAttemptsMs = options?.delayBetweenAttemptsMs ?? 500;
  let lastError: unknown;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    try {
      await readJsonFromChaosTestingToxiproxyResponse<unknown>(`/version`, { method: 'GET' });
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => {
        setTimeout(resolve, delayBetweenAttemptsMs);
      });
    }
  }

  throw new Error(
    `chaos_testing.toxiproxy.health_check.unreachable_after_retries: ${String(lastError)}`,
  );
}

/** Global reset clears every toxin attached to proxies (listening routes stay registered). */
export async function resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy(): Promise<void> {
  await invokeChaosTestingToxiproxyExpectingSuccessfulResponse(`/reset`, {
    method: 'POST',
  });
}

/**
 * Toggle proxy `enabled` (HTTP API) — the Ruby client's `.down` / administrative outage, distinct from toxics.
 */
export async function setChaosTestingListeningProxyEnabledAdministrativeSwitch(
  proxyNameForChaosDatabaseOrRedisTraffic: string,
  enabled: boolean,
): Promise<void> {
  await readJsonFromChaosTestingToxiproxyResponse(
    `/proxies/${encodeURIComponent(proxyNameForChaosDatabaseOrRedisTraffic)}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ enabled }),
    },
  );
}

/** Simulates full dependency outage by disabling the proxy; restores in `finally`. */
export async function withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion<T>(
  proxyNameForChaosDatabaseOrRedisTraffic: string,
  scopedObservationThatDemonstratesGracefulBaseline: () => Promise<T>,
): Promise<T> {
  /**
   * Avoid global `/reset` here: it tears down TCP on every proxy at once, so disabling only the
   * Redis listener would still kill in-flight Postgres pool connections in the same Node process.
   */
  await removeEveryToxinAttachedToListeningChaosTestingProxyDefinition(
    proxyNameForChaosDatabaseOrRedisTraffic,
  );
  await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
    proxyNameForChaosDatabaseOrRedisTraffic,
    true,
  );
  await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
    proxyNameForChaosDatabaseOrRedisTraffic,
    false,
  );
  try {
    return await scopedObservationThatDemonstratesGracefulBaseline();
  } finally {
    await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
      proxyNameForChaosDatabaseOrRedisTraffic,
      true,
    );
    await removeEveryToxinAttachedToListeningChaosTestingProxyDefinition(
      proxyNameForChaosDatabaseOrRedisTraffic,
    );
  }
}

async function deleteAndThenRegisterListeningProxyTowardUpstreamHostname(input: {
  proxyNameForChaosDatabaseOrRedisTraffic: string;
  listenHostnameForChaosProxy: string;
  listenTcpPortPublishedToHostRunner: number;
  upstreamHostnameAndPortInsideToxiproxyNetwork: string;
}): Promise<void> {
  const administratorBaseUrl = resolveChaosTestingToxiproxyAdministratorBaseUrl();
  const listenSpecification = `${input.listenHostnameForChaosProxy}:${input.listenTcpPortPublishedToHostRunner}`;

  const deletionResponse = await fetch(
    `${administratorBaseUrl}/proxies/${encodeURIComponent(input.proxyNameForChaosDatabaseOrRedisTraffic)}`,
    { method: 'DELETE' },
  );

  // Toxiproxy returns 404 when deleting a proxy definition that already disappeared.
  if (!deletionResponse.ok && deletionResponse.status !== 404) {
    const errorMessage = await deletionResponse.text().catch(() => '');
    throw new Error(
      `chaos_testing.toxiproxy.proxy_definition.delete_failed (${deletionResponse.status}): ${errorMessage}`,
    );
  }

  const proxyRegistrationPayload = {
    name: input.proxyNameForChaosDatabaseOrRedisTraffic,
    listen: listenSpecification,
    upstream: input.upstreamHostnameAndPortInsideToxiproxyNetwork,
    enabled: true,
  };

  const creationResponse = await fetch(`${administratorBaseUrl}/proxies`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(proxyRegistrationPayload),
  });

  if (creationResponse.status === 201) {
    return;
  }

  const errorPayload = await creationResponse.text().catch(() => '');
  throw new Error(
    `chaos_testing.toxiproxy.proxy_definition.create_failed (${creationResponse.status}): ${errorPayload}`,
  );
}

/**
 * Register listener ports forwarded to Postgres/Redis upstreams as seen inside the Docker network where
 * Toxiproxy runs (normally `postgres:5432`, `redis:6379`).
 */
export async function provisionChaosListeningProxyRoutesTowardDatabaseAndRedis(): Promise<void> {
  const postgresUpstreamInsideContainerNetwork =
    typeof process.env.CHAOS_TOXIPROXY_POSTGRES_UPSTREAM === 'string'
      ? process.env.CHAOS_TOXIPROXY_POSTGRES_UPSTREAM
      : 'postgres:5432';
  const redisUpstreamInsideContainerNetwork =
    typeof process.env.CHAOS_TOXIPROXY_REDIS_UPSTREAM === 'string'
      ? process.env.CHAOS_TOXIPROXY_REDIS_UPSTREAM
      : 'redis:6379';

  await deleteAndThenRegisterListeningProxyTowardUpstreamHostname({
    proxyNameForChaosDatabaseOrRedisTraffic: CHAOS_POSTGRES_PROXY_NAME,
    listenHostnameForChaosProxy: DEFAULT_CHAOS_POSTGRES_PROXY_LISTEN_HOST,
    listenTcpPortPublishedToHostRunner: DEFAULT_CHAOS_POSTGRES_PROXY_LISTEN_PORT,
    upstreamHostnameAndPortInsideToxiproxyNetwork: postgresUpstreamInsideContainerNetwork,
  });

  await deleteAndThenRegisterListeningProxyTowardUpstreamHostname({
    proxyNameForChaosDatabaseOrRedisTraffic: CHAOS_REDIS_PROXY_NAME,
    listenHostnameForChaosProxy: DEFAULT_CHAOS_REDIS_PROXY_LISTEN_HOST,
    listenTcpPortPublishedToHostRunner: DEFAULT_CHAOS_REDIS_PROXY_LISTEN_PORT,
    upstreamHostnameAndPortInsideToxiproxyNetwork: redisUpstreamInsideContainerNetwork,
  });
}

export async function addToxinOntoListeningChaosTestingProxyDefinition(
  proxyNameForChaosDatabaseOrRedisTraffic: string,
  toxinPayload: ToxinDefinitionForChaosListeningProxy,
): Promise<void> {
  await readJsonFromChaosTestingToxiproxyResponse(
    `/proxies/${encodeURIComponent(proxyNameForChaosDatabaseOrRedisTraffic)}/toxics`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(toxinPayload),
    },
  );
}

function mapToxinListResponseBodiesToDescriptorNames(
  payload: unknown,
): Array<{ toxinName: string }> {
  if (Array.isArray(payload)) {
    return payload.map((entry: { name?: string }) => ({ toxinName: String(entry?.name ?? '') }));
  }

  if (typeof payload === 'object' && payload !== null && !Array.isArray(payload)) {
    return Object.entries(payload).map(([toxinKey]) => ({
      toxinName: toxinKey,
    }));
  }

  return [];
}

export async function listToxinNamesAttachedToListeningChaosTestingProxyDefinition(
  proxyNameForChaosDatabaseOrRedisTraffic: string,
): Promise<string[]> {
  const payloadUnknown = await readJsonFromChaosTestingToxiproxyResponse<unknown>(
    `/proxies/${encodeURIComponent(proxyNameForChaosDatabaseOrRedisTraffic)}/toxics`,
    {
      method: 'GET',
    },
  );

  const descriptors = mapToxinListResponseBodiesToDescriptorNames(payloadUnknown);
  return descriptors.map((descriptor) => descriptor.toxinName).filter((name) => name.length > 0);
}

export async function removeEveryToxinAttachedToListeningChaosTestingProxyDefinition(
  proxyNameForChaosDatabaseOrRedisTraffic: string,
): Promise<void> {
  const toxinNamesOnProxy = await listToxinNamesAttachedToListeningChaosTestingProxyDefinition(
    proxyNameForChaosDatabaseOrRedisTraffic,
  );
  await Promise.all(
    toxinNamesOnProxy.map((toxinName) =>
      invokeChaosTestingToxiproxyExpectingSuccessfulResponse(
        `/proxies/${encodeURIComponent(proxyNameForChaosDatabaseOrRedisTraffic)}/toxics/${encodeURIComponent(toxinName)}`,
        { method: 'DELETE' },
      ).catch(() => {}),
    ),
  );
}

export async function resetChaosTestingListeningProxyFailuresQuietlyDuringTeardownHooks(): Promise<void> {
  try {
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  } catch {
    // Best-effort: ignore missing Toxiproxy during local partial teardown.
  }
}

export async function withTemporaryListeningProxyToxinForChaosAssertion<T>(
  proxyNameForChaosDatabaseOrRedisTraffic: string,
  toxinRegistrationPayload: ToxinDefinitionForChaosListeningProxy,
  scopedObservationThatDemonstratesGracefulBaseline: () => Promise<T>,
): Promise<T> {
  await removeEveryToxinAttachedToListeningChaosTestingProxyDefinition(
    proxyNameForChaosDatabaseOrRedisTraffic,
  );
  await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
    proxyNameForChaosDatabaseOrRedisTraffic,
    true,
  );
  await addToxinOntoListeningChaosTestingProxyDefinition(
    proxyNameForChaosDatabaseOrRedisTraffic,
    toxinRegistrationPayload,
  );
  try {
    return await scopedObservationThatDemonstratesGracefulBaseline();
  } finally {
    await removeEveryToxinAttachedToListeningChaosTestingProxyDefinition(
      proxyNameForChaosDatabaseOrRedisTraffic,
    );
    await setChaosTestingListeningProxyEnabledAdministrativeSwitch(
      proxyNameForChaosDatabaseOrRedisTraffic,
      true,
    );
  }
}

/** Used by migrations, CI harness steps, and Vitest chaos global-setup. */
export async function waitProvisionAndGloballyClearChaosProxyListeners(): Promise<void> {
  await waitUntilChaosTestingToxiproxyRestApiAnswers();
  await provisionChaosListeningProxyRoutesTowardDatabaseAndRedis();
  await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
}
