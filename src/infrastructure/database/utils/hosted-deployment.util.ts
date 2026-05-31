import { env } from '@/shared/config/env.config.js';

/**
 * Detects hosted deployments (production, Railway, or Kubernetes) where safety
 * assertions — Postgres connection budget, DB role RLS bypass guard, etc. —
 * must always fail closed. Local docker-compose and CI runners do not set these
 * markers, so they retain dev-friendly fallbacks (warn-only behavior).
 *
 * @remarks
 * - **Algorithm**: `NODE_ENV === 'production'` OR `RAILWAY_GIT_COMMIT_SHA` set
 *   (Railway injects this at build time) OR `KUBERNETES_SERVICE_HOST` set
 *   (Kubernetes injects this into every pod).
 * - **Notes**: kept as a sibling util in `infrastructure/database/` because it
 *   currently has only one consumer family (boot-time DB safety assertions);
 *   promote to `shared/utils/` if reused outside the DB safety subsystem.
 */
export function isHostedDeployment(): boolean {
  if (env.NODE_ENV === 'production') {
    return true;
  }
  if (env.RAILWAY_GIT_COMMIT_SHA !== undefined) {
    return true;
  }
  if (
    typeof process.env.KUBERNETES_SERVICE_HOST === 'string' &&
    process.env.KUBERNETES_SERVICE_HOST.length > 0
  ) {
    return true;
  }
  return false;
}
