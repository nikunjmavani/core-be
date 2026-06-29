import { eq } from "drizzle-orm";
import { describe, it, expect, beforeEach } from "vitest";
import { BILLING_PERMISSIONS } from "@/domains/billing/billing.permissions.js";
import { cleanupDatabase } from "@/tests/helpers/test-database.js";
import { createTestUser } from "@/tests/factories/user.factory.js";
import { seedPermissions } from "@/domains/tenancy/__tests__/factories/permission.factory.js";
import { TENANCY_PERMISSIONS } from "@/domains/tenancy/tenancy.permissions.js";
import {
  ownerPermissionCodesForOrganizationType,
  provisionOrganizationWithOwner,
} from "@/domains/tenancy/sub-domains/organization/organization-provisioning.js";
import { role_permissions } from "@/domains/tenancy/sub-domains/member-roles/member-role-permission/member-role-permission.schema.js";
import { database } from "@/infrastructure/database/connection.js";

describe("team organization provisioning (database)", () => {
  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions([
      ...Object.values(TENANCY_PERMISSIONS),
      ...Object.values(BILLING_PERMISSIONS),
    ]);
  });

  it("grants billing permissions to TEAM org owners", async () => {
    const user = await createTestUser();

    const result = await provisionOrganizationWithOwner({
      name: "Acme",
      slug: "acme-team-provision",
      type: "TEAM",
      ownerUserId: user.id,
    });

    const codes = ownerPermissionCodesForOrganizationType("TEAM");
    expect(codes).toContain(BILLING_PERMISSIONS.SUBSCRIPTION_READ);
    expect(codes).toContain(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE);

    const rows = await database
      .select({ permission_code: role_permissions.permission_code })
      .from(role_permissions)
      .where(eq(role_permissions.role_id, result.roleId));

    const granted = rows.map((row) => row.permission_code);
    expect(granted).toContain(BILLING_PERMISSIONS.SUBSCRIPTION_READ);
    expect(granted).toContain(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE);
  });

  it("does not grant billing permissions to PERSONAL org owners", async () => {
    const codes = ownerPermissionCodesForOrganizationType("PERSONAL");
    expect(codes).not.toContain(BILLING_PERMISSIONS.SUBSCRIPTION_READ);
    expect(codes).not.toContain(BILLING_PERMISSIONS.SUBSCRIPTION_MANAGE);
  });
});
