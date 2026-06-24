import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { generateTestTokenAndSession } from '@/tests/helpers/test-auth.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { seedPermissions } from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { TENANCY_PERMISSIONS } from '@/domains/tenancy/tenancy.permissions.js';
import {
  provisionPersonalOrganization,
  provisionOrganizationWithOwner,
} from '@/domains/tenancy/sub-domains/organization/organization-provisioning.js';
import { database } from '@/infrastructure/database/connection.js';
import { organizations } from '@/domains/tenancy/sub-domains/organization/organization.schema.js';
import { memberships } from '@/domains/tenancy/sub-domains/membership/membership.schema.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';

describe('Auth e2e: organization switch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { app: testApplication } = await createTestApp();
    app = testApplication;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
    await seedPermissions(Object.values(TENANCY_PERMISSIONS));
  });

  it('switch-to-personal re-mints the token and returns the active-org delta (201)', async () => {
    const user = await createTestUser();
    const { organization } = await provisionPersonalOrganization(user.id);
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-personal'),
      token,
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      data: {
        access_token: string;
        active_organization: {
          id: string;
          type: string;
        };
        my_permissions: string[];
        global_role: string | null;
      };
    };
    // Inline active-org delta — the client repaints the dashboard without a second GET /me/context.
    expect(body.data.access_token).toBeDefined();
    expect(body.data.active_organization.id).toBe(organization.public_id);
    expect(body.data.active_organization.type).toBe('PERSONAL');
    expect(Array.isArray(body.data.my_permissions)).toBe(true);
    expect(body.data).toHaveProperty('global_role');
  });

  it('switch-to-personal returns 404 when the user has no personal organization', async () => {
    const user = await createTestUser();
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-personal'),
      token,
    });

    expect(response.statusCode).toBe(404);
  });

  it('switch-to-organization re-mints for an org the caller is a member of (201)', async () => {
    const user = await createTestUser();
    const { organization } = await provisionPersonalOrganization(user.id);
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-organization'),
      token,
      payload: { organization_id: organization.public_id },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as {
      data: { access_token: string; active_organization: { id: string }; my_permissions: string[] };
    };
    // Inline active-org delta (gate reduction: no follow-up GET /me/context needed).
    expect(body.data.access_token).toBeDefined();
    expect(body.data.active_organization.id).toBe(organization.public_id);
    expect(Array.isArray(body.data.my_permissions)).toBe(true);
  });

  it('switch-to-organization returns 403 for an org the caller does not belong to', async () => {
    const member = await createTestUser();
    const stranger = await createTestUser();
    const { organization } = await provisionPersonalOrganization(member.id);
    const { token } = await generateTestTokenAndSession({ userId: stranger.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-organization'),
      token,
      payload: { organization_id: organization.public_id },
    });

    expect(response.statusCode).toBe(403);
  });

  it('switch-to-organization returns 400 when organization_id is missing', async () => {
    const user = await createTestUser();
    const { token } = await generateTestTokenAndSession({ userId: user.public_id });

    const response = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath('/auth/switch-to-organization'),
      token,
      payload: {},
    });

    expect(response.statusCode).toBe(400);
  });

  // M1 — TRUST GUARANTEE: a switch re-binds the session token-hash, so the token held
  // BEFORE the switch must die on its next use. This proves a switched-away token cannot
  // continue acting in its old scope (a stolen pre-switch token is useless after the user
  // moves on). Uses a REAL session-backed token because the switch endpoints require
  // `auth.sessionPublicId` to rebind.
  describe('M1: the pre-switch token is invalidated by the rebind', () => {
    it('rejects the OLD token (401) after switch-to-organization, while the NEW token works (200)', async () => {
      // A user who is an ACTIVE owner-member of both org A (token scope) and org B.
      const user = await createTestUser();
      const orgA = await provisionOrganizationWithOwner({
        name: 'M1 Org A',
        slug: `m1-org-a-${generatePublicId('organization').slice(4, 14)}`,
        type: 'TEAM',
        ownerUserId: user.id,
      });
      const orgB = await provisionOrganizationWithOwner({
        name: 'M1 Org B',
        slug: `m1-org-b-${generatePublicId('organization').slice(4, 14)}`,
        type: 'TEAM',
        ownerUserId: user.id,
      });

      const { token: oldToken } = await generateTestTokenAndSession({
        userId: user.public_id,
        organizationPublicId: orgA.organization.public_id,
      });

      // Sanity: the original token works against an authenticated route before the switch.
      const beforeSwitch = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me'),
        token: oldToken,
      });
      expect(beforeSwitch.statusCode).toBe(200);

      // Switch the active organization to B → 201, capturing the freshly minted token.
      const switchResponse = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/switch-to-organization'),
        token: oldToken,
        payload: { organization_id: orgB.organization.public_id },
      });
      expect(switchResponse.statusCode).toBe(201);
      const newToken = (switchResponse.json() as { data: { access_token: string } }).data
        .access_token;
      expect(newToken).toBeDefined();
      expect(newToken).not.toBe(oldToken);

      // The OLD (pre-switch) token's hash no longer matches the rebound session row →
      // verifyActiveAccessToken finds no active session → 401 on the next request.
      const replayOld = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me'),
        token: oldToken,
      });
      expect(replayOld.statusCode).toBe(401);

      // The OLD token is equally dead against an org-scoped route.
      const replayOldOrg = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/tenancy/organization'),
        token: oldToken,
      });
      expect(replayOldOrg.statusCode).toBe(401);

      // The NEW token (now bound to the session) still authenticates.
      const replayNew = await injectAuthenticated(app, {
        method: 'GET',
        url: testApiPath('/users/me'),
        token: newToken,
      });
      expect(replayNew.statusCode).toBe(200);
    });
  });

  // M2 — TRUST GUARANTEE: switch-to-organization mints a new `org` claim ONLY after
  // verifying an ACTIVE membership in an ACTIVE, non-deleted org. It must reject every
  // path that would otherwise let a caller mint a claim they are not entitled to.
  // (The plain non-member 403 is covered above; these add the SUSPENDED-member and
  // deleted-org cases the audit flagged.)
  describe('M2: switch-to-organization rejects what it should', () => {
    it('returns 403 when the caller is a member but their membership is SUSPENDED', async () => {
      // The user owns a personal org (so the account resolves), and holds a SUSPENDED
      // membership in a separate TEAM org they must not be able to switch into.
      const user = await createTestUser();
      await provisionPersonalOrganization(user.id);

      const owner = await createTestUser();
      const team = await provisionOrganizationWithOwner({
        name: 'M2 Suspended Team',
        slug: `m2-susp-${generatePublicId('organization').slice(4, 14)}`,
        type: 'TEAM',
        ownerUserId: owner.id,
      });
      // Give `user` a SUSPENDED membership in the team (joined_at set so the row is a
      // previously-active member who was suspended, not a never-joined invite).
      await database.insert(memberships).values({
        public_id: generatePublicId('membership'),
        user_id: user.id,
        organization_id: team.organization.id,
        role_id: team.roleId,
        status: 'SUSPENDED',
        joined_at: new Date(),
      });

      const { token } = await generateTestTokenAndSession({ userId: user.public_id });

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/switch-to-organization'),
        token,
        payload: { organization_id: team.organization.public_id },
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 403/404 when the target organization is soft-deleted', async () => {
      // The user is an ACTIVE owner-member, but the org has been soft-deleted: the
      // membership gate requires a non-deleted org, so the switch must be refused even
      // though an ACTIVE membership row still exists.
      const user = await createTestUser();
      await provisionPersonalOrganization(user.id);
      const team = await provisionOrganizationWithOwner({
        name: 'M2 Deleted Team',
        slug: `m2-del-${generatePublicId('organization').slice(4, 14)}`,
        type: 'TEAM',
        ownerUserId: user.id,
      });

      await database
        .update(organizations)
        .set({ deleted_at: new Date() })
        .where(eq(organizations.id, team.organization.id));

      const { token } = await generateTestTokenAndSession({ userId: user.public_id });

      const response = await injectAuthenticated(app, {
        method: 'POST',
        url: testApiPath('/auth/switch-to-organization'),
        token,
        payload: { organization_id: team.organization.public_id },
      });

      expect([403, 404]).toContain(response.statusCode);
    });
  });
});
