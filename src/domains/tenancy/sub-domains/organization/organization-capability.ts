import { UnprocessableEntityError } from '@/shared/errors/index.js';

/**
 * A team-only capability a caller may attempt to exercise on an organization.
 * Selects the matching i18n rejection key in {@link assertTeamOrganization} when
 * the target is a PERSONAL organization.
 *
 * - `MEMBERS` — add or invite a second member (collaboration).
 * - `ROLES` — create or manage custom member roles.
 * - `MUTATION` — owner-level structural change (delete or transfer ownership).
 */
export type OrganizationCapability = 'MEMBERS' | 'ROLES' | 'MUTATION';

/**
 * Public, type-derived capability flags embedded on every serialized organization.
 * They describe what the organization **type** permits — not what the current
 * caller is authorized to do (that is governed separately by permissions/roles).
 */
export interface OrganizationCapabilities {
  /** TEAM organizations can invite additional members; PERSONAL cannot. */
  can_invite_members: boolean;
  /** TEAM organizations can add or manage members directly; PERSONAL cannot. */
  can_manage_members: boolean;
  /** TEAM organizations can define custom member roles; PERSONAL cannot. */
  can_manage_roles: boolean;
  /** TEAM organizations can transfer ownership; PERSONAL cannot. */
  can_transfer_ownership: boolean;
  /** TEAM organizations can be deleted on their own; a PERSONAL org cascades with the account only. */
  can_delete: boolean;
}

/** Organization `type` for a single-owner account workspace (no collaboration). */
const PERSONAL_ORGANIZATION_TYPE = 'PERSONAL';
/** Organization `type` for a shareable, multi-member workspace. */
const TEAM_ORGANIZATION_TYPE = 'TEAM';

/** Maps an attempted {@link OrganizationCapability} to its PERSONAL-organization rejection key. */
const CAPABILITY_REJECTION_KEY: Record<OrganizationCapability, string> = {
  MEMBERS: 'errors:personalOrganizationNoMembers',
  ROLES: 'errors:personalOrganizationNoRoles',
  MUTATION: 'errors:personalOrganizationImmutable',
};

/**
 * Derives the public {@link OrganizationCapabilities} flags for an organization
 * from its `type`.
 *
 * @param type - The organization `type` (`PERSONAL` or `TEAM`).
 * @returns Capability flags: all `true` for a TEAM organization, all `false` otherwise.
 *
 * @remarks
 * - **Algorithm:** pure mapping on `type` — `TEAM` ⇒ every flag `true`, otherwise
 *   every flag `false`. No I/O.
 * - **Side effects:** none.
 * - **Notes:** flags describe the organization **type**, not caller permission, so
 *   clients can hide or disable team-only actions for a personal workspace instead
 *   of probing for a 422. Kept in lockstep with {@link assertTeamOrganization}.
 */
export function organizationCapabilities(type: string): OrganizationCapabilities {
  const isTeam = type === TEAM_ORGANIZATION_TYPE;
  return {
    can_invite_members: isTeam,
    can_manage_members: isTeam,
    can_manage_roles: isTeam,
    can_transfer_ownership: isTeam,
    can_delete: isTeam,
  };
}

/**
 * Guards a team-only capability: rejects with 422 when `organization` is a
 * PERSONAL organization, otherwise returns without effect.
 *
 * @param organization - The target organization (only `type` is read).
 * @param capability - The capability being attempted; selects the i18n key.
 * @throws UnprocessableEntityError When the organization is PERSONAL — the org
 *   `type` is immutable, so retrying the identical request can never succeed
 *   (422 `unprocessable_entity`, not 409).
 *
 * @remarks
 * - **Algorithm:** if `type === 'PERSONAL'`, throw `UnprocessableEntityError`
 *   keyed by {@link CAPABILITY_REJECTION_KEY}; otherwise no-op.
 * - **Failure modes:** PERSONAL organization ⇒ 422 `unprocessable_entity`.
 * - **Side effects:** none (pure guard; throws or returns).
 * - **Notes:** single source for the personal-vs-team rule shared by
 *   member-invitation, membership (add member / transfer ownership), member-role,
 *   and organization delete, so enforcement and {@link organizationCapabilities}
 *   never drift.
 */
export function assertTeamOrganization(
  organization: { type: string },
  capability: OrganizationCapability,
): void {
  if (organization.type === PERSONAL_ORGANIZATION_TYPE) {
    throw new UnprocessableEntityError(CAPABILITY_REJECTION_KEY[capability]);
  }
}
