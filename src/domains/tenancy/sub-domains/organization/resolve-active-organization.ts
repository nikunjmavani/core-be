import { withGlobalAdminDatabaseContext } from '@/infrastructure/database/contexts/global-admin-database.context.js';
import { env } from '@/shared/config/env.config.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { provisionPersonalOrganization } from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import { OrganizationRepository } from '@/domains/tenancy/sub-domains/organization/organization.repository.js';

/**
 * Orchestrates the login/active-organization lookups under the global-admin RLS context. The SQL
 * lives in {@link OrganizationRepository}; these helpers only choose the context and map the
 * repository's `null` to `undefined` for their callers.
 *
 * @remarks
 * - **RLS:** every lookup runs under {@link withGlobalAdminDatabaseContext} because the auth flows
 *   that call them (login, MFA, organization switch) have no `app.current_organization_id` yet —
 *   the memberships/organizations policies are keyed on it. The context pins a handle in ALS so the
 *   repository's request-scoped reads resolve to the admin transaction. Each query is constrained
 *   to the authenticated user's own `user_id`, so the bypass never reads cross-user data.
 * - **Side effects:** none (read-only).
 */
const organizationRepository = new OrganizationRepository();

/**
 * Resolve the default active organization for a user at login: the PERSONAL organization
 * (when `PERSONAL_ORGANIZATION_ENABLED`), otherwise the most-recently-joined active TEAM
 * membership. Returns the organization `public_id`, or `undefined` when the user belongs to
 * no eligible organization (team-only mode, no team yet → the frontend redirects to onboarding).
 */
export async function resolveDefaultActiveOrganizationPublicId(
  userInternalId: number,
): Promise<string | undefined> {
  const resolved = await withGlobalAdminDatabaseContext(() =>
    organizationRepository.findDefaultActiveOrganizationPublicId(
      userInternalId,
      env.PERSONAL_ORGANIZATION_ENABLED,
    ),
  );
  return resolved ?? undefined;
}

/**
 * Confirm the user holds an ACTIVE membership in the given organization (and the org is
 * active/not-deleted), returning both the internal `id` and `public_id`. Runs under the
 * global-admin RLS context (no org context at switch time) but is constrained to the
 * caller's own `user_id`.
 *
 * @remarks
 * - **Algorithm:** one indexed join (memberships → organizations) filtered to ACTIVE
 *   membership + active/non-deleted org matching `organizationPublicId`.
 * - **Side effects:** none (read-only). Returns `undefined` when no such active
 *   membership exists (caller maps to 403, or falls back to a default org).
 */
export async function findUserActiveOrganizationByPublicId(
  userInternalId: number,
  organizationPublicId: string,
): Promise<{ id: number; public_id: string } | undefined> {
  const resolved = await withGlobalAdminDatabaseContext(() =>
    organizationRepository.findActiveMembershipOrganizationByPublicId(
      userInternalId,
      organizationPublicId,
    ),
  );
  return resolved ?? undefined;
}

/**
 * Confirm the user holds an ACTIVE membership in the given organization (and the org is
 * active/not-deleted) — the membership gate for `switch-to-organization`. Returns the
 * org `public_id` when valid, otherwise `undefined` (caller maps to 403). Runs under the
 * global-admin RLS context (no org context at switch time) but is constrained to the
 * caller's own `user_id`.
 */
export async function findUserActiveOrganizationPublicId(
  userInternalId: number,
  organizationPublicId: string,
): Promise<string | undefined> {
  return (await findUserActiveOrganizationByPublicId(userInternalId, organizationPublicId))
    ?.public_id;
}

/**
 * Refresh-time revalidation of the active organization persisted on a session
 * (audit-#3). Given the session's stored internal `organization_id`, confirm the
 * user still holds an ACTIVE membership in that active/non-deleted org and return
 * its `public_id`; otherwise `undefined` so the caller falls back to the default
 * active organization. Constrained to the caller's own `user_id` under the
 * global-admin RLS context (no org context at refresh time).
 */
export async function findUserActiveOrganizationPublicIdByInternalId(
  userInternalId: number,
  organizationInternalId: number,
): Promise<string | undefined> {
  const resolved = await withGlobalAdminDatabaseContext(() =>
    organizationRepository.findActiveMembershipOrganizationPublicIdByInternalId(
      userInternalId,
      organizationInternalId,
    ),
  );
  return resolved ?? undefined;
}

/**
 * Resolve the caller's own PERSONAL organization `public_id` — the target for
 * `switch-to-personal` (no body; the server resolves it). Returns `undefined` when the
 * user has no personal organization (e.g. personal disabled), which the caller maps to 409.
 */
export async function resolvePersonalOrganizationPublicId(
  ownerUserInternalId: number,
): Promise<string | undefined> {
  return (await resolvePersonalOrganization(ownerUserInternalId))?.public_id;
}

/**
 * Same as {@link resolvePersonalOrganizationPublicId} but returns both the
 * internal `id` and `public_id` so the switch-to-personal path can persist the
 * internal id on the session row (audit-#3).
 */
export async function resolvePersonalOrganization(
  ownerUserInternalId: number,
): Promise<{ id: number; public_id: string } | undefined> {
  const resolved = await withGlobalAdminDatabaseContext(() =>
    organizationRepository.findPersonalOrganization(ownerUserInternalId),
  );
  return resolved ?? undefined;
}

/**
 * Resolve the caller's PERSONAL organization, **self-healing** on a miss: when
 * `PERSONAL_ORGANIZATION_ENABLED` is true and the user has no personal organization,
 * provision it on demand and return it. This closes the gap left by best-effort
 * signup-time provisioning (email first-verification / OAuth new-user), where a swallowed
 * failure or a flag flipped on after signup would otherwise leave a personal-enabled user
 * permanently without a personal workspace — dead-ending onboarding.
 *
 * Returns `undefined` only when personal organizations are **disabled** for the deployment
 * (`PERSONAL_ORGANIZATION_ENABLED=false`); in that mode we never create one, so callers
 * (`getMe` → `personal_organization_id: null`, `switch-to-personal` → 404) behave as before.
 *
 * @remarks
 * - **Idempotency:** `provisionPersonalOrganization` is guarded by the
 *   `idx_org_one_personal_per_owner` partial unique index (at most one personal org per
 *   owner). A concurrent provision that loses the race raises a unique violation; we absorb it
 *   and re-resolve, so this function never creates a duplicate and never surfaces the race to
 *   the caller.
 * - **RLS:** provisioning runs inside its own `withGlobalAdminDatabaseContext` write
 *   transaction (see {@link provisionPersonalOrganization}); the surrounding reads use the
 *   same admin context, constrained to the caller's own `user_id`.
 * - **Side effects:** provisions one organization (+ owner role, permissions, membership)
 *   on the self-heal path; read-only when the personal org already exists or personal is
 *   disabled.
 */
export async function ensurePersonalOrganization(
  ownerUserInternalId: number,
): Promise<{ id: number; public_id: string } | undefined> {
  const existing = await resolvePersonalOrganization(ownerUserInternalId);
  if (existing) return existing;
  if (!env.PERSONAL_ORGANIZATION_ENABLED) return undefined;

  try {
    const provisioned = await provisionPersonalOrganization(ownerUserInternalId);
    logger.info(
      {
        userInternalId: ownerUserInternalId,
        organizationPublicId: provisioned.organization.public_id,
      },
      'personal_organization.self_heal.provisioned',
    );
    return {
      id: provisioned.organization.id,
      public_id: provisioned.organization.public_id,
    };
  } catch (error) {
    // A concurrent self-heal (or signup-time provision) may have won the race; the partial
    // unique index makes the second insert fail. Re-resolve and return the winner's row.
    const afterRace = await resolvePersonalOrganization(ownerUserInternalId);
    if (afterRace) return afterRace;
    logger.error(
      { err: error, userInternalId: ownerUserInternalId },
      'personal_organization.self_heal.failed',
    );
    throw error;
  }
}

/**
 * `public_id`-only, **read-safe** variant of {@link ensurePersonalOrganization} for
 * self-service read paths that must never fail because self-heal could not provision
 * (e.g. `getMe` → `personal_organization_id`). Attempts the on-demand provision, but if it
 * throws (a genuine provisioning failure — e.g. a missing reference row / transient DB error,
 * NOT a lost idempotency race, which {@link ensurePersonalOrganization} already absorbs) it
 * **degrades gracefully**: it logs and returns the pre-existing personal-org id, or
 * `undefined` when there is still none. This guarantees a read like `GET /users/me` returns
 * 200 with `personal_organization_id: null` rather than 500-ing on a self-heal hiccup; the
 * user simply retries and the next read (or `switch-to-personal`) heals them once the
 * underlying cause clears. Returns `undefined` when personal organizations are disabled.
 *
 * @remarks
 * - **Side effects:** provisions on the happy path; on failure it is read-only (best-effort).
 * - **Contract:** callers get a non-throwing resolution — never propagate the provisioning
 *   error to the HTTP response.
 */
export async function ensurePersonalOrganizationPublicId(
  ownerUserInternalId: number,
): Promise<string | undefined> {
  try {
    return (await ensurePersonalOrganization(ownerUserInternalId))?.public_id;
  } catch (error) {
    // Never let a self-heal failure break the read. Fall back to whatever already exists
    // (typically none → undefined → the caller reports null). ensurePersonalOrganization
    // already logged the failure at error level.
    logger.warn(
      { err: error, userInternalId: ownerUserInternalId },
      'personal_organization.self_heal.read_degraded',
    );
    return (await resolvePersonalOrganization(ownerUserInternalId))?.public_id;
  }
}
