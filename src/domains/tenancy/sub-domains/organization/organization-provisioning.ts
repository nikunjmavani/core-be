import { withGlobalAdminDatabaseContext } from "@/infrastructure/database/contexts/global-admin-database.context.js";
import { generatePublicId } from "@/shared/utils/identity/public-id.util.js";
import { BILLING_PERMISSIONS } from "@/domains/billing/billing.permissions.js";
import { TENANCY_PERMISSIONS } from "@/domains/tenancy/tenancy.permissions.js";
import { roles } from "@/domains/tenancy/sub-domains/member-roles/member-role.schema.js";
import { role_permissions } from "@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.schema.js";
import { memberships } from "@/domains/tenancy/sub-domains/membership/membership.schema.js";
import { organizations } from "@/domains/tenancy/sub-domains/organization/organization.schema.js";
import type { Organization } from "@/domains/tenancy/sub-domains/organization/organization.types.js";

/** Name of the auto-provisioned, undeletable owner role created with every organization. */
export const OWNER_ROLE_NAME = "Owner";

/** Every tenancy permission code — the owner role is granted the full set. */
const ALL_TENANCY_PERMISSION_CODES: readonly string[] =
  Object.values(TENANCY_PERMISSIONS);

const ALL_BILLING_PERMISSION_CODES: readonly string[] =
  Object.values(BILLING_PERMISSIONS);

/**
 * Permission codes granted to the auto-provisioned Owner role.
 * TEAM organizations also receive billing read/manage so the creator can use `/billing/*`.
 */
export function ownerPermissionCodesForOrganizationType(
  type: ProvisionOrganizationInput["type"],
): readonly string[] {
  if (type === "TEAM") {
    return [...ALL_TENANCY_PERMISSION_CODES, ...ALL_BILLING_PERMISSION_CODES];
  }
  return ALL_TENANCY_PERMISSION_CODES;
}

/** Input for {@link provisionOrganizationWithOwner}. */
export interface ProvisionOrganizationInput {
  name: string;
  /** Null for a PERSONAL organization; kebab string for a TEAM. */
  slug: string | null;
  type: "PERSONAL" | "TEAM";
  ownerUserId: number;
}

/** Result of {@link provisionOrganizationWithOwner}. */
export interface ProvisionOrganizationResult {
  organization: Organization;
  roleId: number;
  membershipPublicId: string;
}

/**
 * Atomically bootstrap an organization with full owner access: organization row →
 * system `Owner` role → every tenancy permission granted to it (plus billing read/manage
 * for TEAM orgs) → the owner's ACTIVE membership. Without this, a freshly created
 * organization's owner resolves zero permissions (the permission path is a strict
 * role→membership join with no owner shortcut).
 *
 * @remarks
 * - **Algorithm:** runs all four inserts inside a single `withGlobalAdminDatabaseContext`
 *   transaction. The global-admin context is required because the inserts span RLS
 *   boundaries (the org row is gated by `app.current_user_id`, while roles/memberships are
 *   gated by `app.current_organization_id`); doing them under one RLS-bypass transaction
 *   keeps the owner-bootstrap atomic — a partial failure can never leave an org whose owner
 *   has no access. This is a server-side bootstrap only; the inputs are not user-controlled
 *   beyond name/slug/type.
 * - **Failure modes:** the whole transaction rolls back on any insert failure (unique slug,
 *   one-personal-per-owner index, missing permission reference rows). Callers map
 *   `unique_violation` to a 409.
 * - **Side effects:** four table inserts (organizations, roles, role_permissions, memberships).
 * - **Notes:** the owner role is `is_system: true` so it cannot be deleted via the role API.
 *   Permission reference rows (the `permissions` table) are assumed seeded — they are
 *   reference data present in every environment.
 */
export async function provisionOrganizationWithOwner(
  input: ProvisionOrganizationInput,
): Promise<ProvisionOrganizationResult> {
  return provisionOrganization(input);
}

/** Default display name for an auto-provisioned personal organization. */
export const PERSONAL_ORGANIZATION_NAME = "Personal";

/**
 * Provision the single PERSONAL organization for a user at signup: a `type=PERSONAL`,
 * slug-less organization owned by the user, with full owner access. The partial unique
 * index guarantees at most one personal organization per owner.
 */
export async function provisionPersonalOrganization(
  ownerUserId: number,
  name: string = PERSONAL_ORGANIZATION_NAME,
): Promise<ProvisionOrganizationResult> {
  return provisionOrganization({
    name,
    slug: null,
    type: "PERSONAL",
    ownerUserId,
  });
}

async function provisionOrganization(
  input: ProvisionOrganizationInput,
): Promise<ProvisionOrganizationResult> {
  return withGlobalAdminDatabaseContext(async (databaseHandle) => {
    const [organization] = await databaseHandle
      .insert(organizations)
      .values({
        public_id: generatePublicId("organization"),
        name: input.name,
        slug: input.slug,
        type: input.type,
        owner_user_id: input.ownerUserId,
        created_by_user_id: input.ownerUserId,
        updated_by_user_id: input.ownerUserId,
      })
      .returning();

    const [role] = await databaseHandle
      .insert(roles)
      .values({
        public_id: generatePublicId("memberRole"),
        organization_id: organization!.id,
        name: OWNER_ROLE_NAME,
        is_system: true,
        created_by_user_id: input.ownerUserId,
      })
      .returning();

    await databaseHandle.insert(role_permissions).values(
      ownerPermissionCodesForOrganizationType(input.type).map(
        (permission_code) => ({
          role_id: role!.id,
          permission_code,
          created_by_user_id: input.ownerUserId,
        }),
      ),
    );

    const [membership] = await databaseHandle
      .insert(memberships)
      .values({
        public_id: generatePublicId("membership"),
        user_id: input.ownerUserId,
        organization_id: organization!.id,
        role_id: role!.id,
        status: "ACTIVE",
        joined_at: new Date(),
      })
      .returning();

    return {
      organization: organization! as Organization,
      roleId: role!.id,
      membershipPublicId: membership!.public_id,
    };
  });
}
