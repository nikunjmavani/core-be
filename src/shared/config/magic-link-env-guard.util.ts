/**
 * Guards against magic-link token leakage when NODE_ENV is mis-set on a deployed host.
 * Non-production API responses may include the raw magic-link token for local testing only.
 */

const ALLOWED_NON_PRODUCTION_NODE_ENV = new Set(['local', 'development', 'test']);

export function isLocalFrontendHostname(frontendUrl: string): boolean {
  try {
    const hostname = new URL(frontendUrl).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function assertMagicLinkEnvironmentSafe(options: {
  nodeEnv: string;
  frontendUrl?: string;
}): void {
  if (options.nodeEnv === 'production') {
    return;
  }

  if (!ALLOWED_NON_PRODUCTION_NODE_ENV.has(options.nodeEnv)) {
    throw new Error(
      `Magic-link safety: NODE_ENV="${options.nodeEnv}" is not allowed. Use NODE_ENV=production on deployed environments (Railway, staging, production). Allowed non-production values: ${[...ALLOWED_NON_PRODUCTION_NODE_ENV].join(', ')}.`,
    );
  }

  if (options.frontendUrl && !isLocalFrontendHostname(options.frontendUrl)) {
    throw new Error(
      'Magic-link safety: when NODE_ENV is not production, FRONTEND_URL must use localhost or 127.0.0.1 to prevent magic-link token leakage in API responses.',
    );
  }
}
