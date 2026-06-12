import Fastify from 'fastify';
import { Sentry, isSentryInitialized } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { env, getEnv } from '@/shared/config/env.config.js';
import { registerMiddleware } from '@/shared/middlewares/index.js';
import { registerEventHandlers } from '@/core/events/register-event-handlers.js';
import { registerRoutes } from '@/routes.js';
import { buildFastifyServerOptions } from '@/shared/utils/http/fastify-server.util.js';
import { isStripeWebhookRawBodyRoute } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-raw-body.registry.js';

const API_SERVER_NAME = 'core-be';
const API_SERVER_VERSION = '1.0.0';
const STRIPE_SIGNATURE_HEADER = 'stripe-signature';

/**
 * sec-B finding #7: the prior implementation used a hardcoded
 * `RAW_BODY_CAPTURE_PATHS = new Set([...])` Set of webhook URLs, which had to stay
 * in lockstep with `stripe-webhook.routes.ts` by string equality. Any restructure
 * (API version bump, route move, prefix change) that didn't update both files
 * silently broke every webhook signature verification for the 3-day Stripe retry
 * window. We now read from `stripe-webhook-raw-body.registry.ts`, which the routes
 * module populates at registration time via its `onRoute` hook — the URLs are
 * authored once in the route declaration.
 */
function shouldCaptureRawBody(request: { url: string; headers: Record<string, unknown> }): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  return (
    isStripeWebhookRawBodyRoute(path) && request.headers[STRIPE_SIGNATURE_HEADER] !== undefined
  );
}

/**
 * Shape captured by `BuildAppOptions.captureRegisteredRoutes` — one entry per
 * HTTP method / URL pair registered with Fastify.
 */
export type RegisteredRouteCapture = {
  method: string;
  url: string;
};

/**
 * One routed response reported to {@link BuildAppOptions.observeResponses}:
 * the HTTP method, the registered route pattern (e.g. `/api/v1/users/:userId`),
 * and the final response status code.
 */
export type ObservedRouteResponse = {
  method: string;
  routeUrl: string;
  statusCode: number;
};

/**
 * Optional knobs for {@link buildApp} consumed by tests. Production callers
 * (`src/index.ts`, the worker entry) pass nothing.
 */
export type BuildAppOptions = {
  /** When set, every registered HTTP route is appended (used by route parity tests). */
  captureRegisteredRoutes?: RegisteredRouteCapture[];
  /**
   * When set, every routed response is reported after it is sent (used by the
   * route success-status coverage gate). Registered before middleware and
   * routes so all encapsulated contexts inherit the hook.
   */
  observeResponses?: (observation: ObservedRouteResponse) => void;
};

/**
 * Builds a fully wired Fastify app: middleware, raw-body capture for webhook
 * signature verification, in-process event handlers, all routes, and (when
 * enabled) the Scalar API reference and MCP server. Returns the unstarted app
 * instance — the caller is responsible for `listen()` so tests can use
 * `app.inject()` without binding a port.
 */
export async function buildApp(options?: BuildAppOptions) {
  const app = Fastify(buildFastifyServerOptions());

  if (options?.captureRegisteredRoutes) {
    const captures = options.captureRegisteredRoutes;
    app.addHook('onRoute', (routeOptions) => {
      const methods = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method];
      for (const method of methods) {
        if (method === 'HEAD') continue;
        captures.push({ method: method.toUpperCase(), url: routeOptions.url });
      }
    });
  }

  if (options?.observeResponses) {
    const observeResponses = options.observeResponses;
    app.addHook('onResponse', async (request, reply) => {
      const routeUrl = request.routeOptions.url;
      if (!routeUrl) {
        return;
      }
      observeResponses({
        method: request.method.toUpperCase(),
        routeUrl,
        statusCode: reply.statusCode,
      });
    });
  }

  const keepAliveTimeoutMs = env.FASTIFY_KEEP_ALIVE_TIMEOUT_MS ?? 72_000;
  const headersTimeoutMs = env.FASTIFY_HEADERS_TIMEOUT_MS ?? 73_000;
  app.server.keepAliveTimeout = keepAliveTimeoutMs;
  app.server.headersTimeout = headersTimeoutMs;

  // Capture raw body only for signed Stripe webhook requests.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    const buffer = typeof body === 'string' ? Buffer.from(body) : body;
    if (shouldCaptureRawBody(request)) {
      (request as unknown as { rawBody: Buffer }).rawBody = buffer;
    }
    // sec-r5-runtime: clients (curl, browsers, SDKs) commonly send POST/DELETE
    // requests with `Content-Type: application/json` and no body — e.g.
    // /auth/logout, /me/sessions DELETE, etc. JSON.parse('') throws
    // `SyntaxError: Unexpected end of JSON input`, which Fastify surfaces as
    // a 500 instead of routing the request to its handler. Treat an empty
    // buffer as `undefined` so the route validator (Zod) sees no body and
    // either accepts or rejects per its declared schema.
    const text = buffer.toString();
    if (text.length === 0) {
      done(null, undefined);
      return;
    }
    try {
      const json = JSON.parse(text) as unknown;
      done(null, json);
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  await registerMiddleware(app);
  registerEventHandlers();
  await registerRoutes(app);

  if (getEnv().ENABLE_API_REFERENCE) {
    const { registerScalarApiReference } = await import(
      '@/infrastructure/api-reference/scalar-api-reference.js'
    );
    await registerScalarApiReference(app);
  }

  if (getEnv().ENABLE_MCP_SERVER) {
    try {
      const { registerMcpRoute } = await import('@/infrastructure/mcp/mcp-server.js');
      await registerMcpRoute(app, { name: API_SERVER_NAME, version: API_SERVER_VERSION });
    } catch (error) {
      logger.error({ error }, 'Failed to load MCP server module');
      throw new Error(
        'ENABLE_MCP_SERVER is true but the MCP server could not be loaded. Install optional dependency @modelcontextprotocol/sdk (e.g. pnpm install without --no-optional, or Docker build-arg INSTALL_MCP_OPTIONAL=true).',
        { cause: error },
      );
    }
  }

  // Sentry Fastify error handler — gives Sentry full route context
  // (method, url, params, query, headers) on every captured error.
  // Must be registered after all routes and middleware.
  if (isSentryInitialized()) {
    Sentry.setupFastifyErrorHandler(app);
  }

  return app;
}
