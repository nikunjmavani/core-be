import { randomUUID, createHash } from 'node:crypto';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectAuthenticated } from '@/tests/helpers/test-http-inject.helper.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import {
  createRoleWithPermissions,
  createMembership,
} from '@/domains/tenancy/__tests__/factories/permission.factory.js';
import { generateTestToken } from '@/tests/helpers/test-auth.js';
import { generatePublicId } from '@/shared/utils/identity/public-id.util.js';
import { database } from '@/infrastructure/database/connection.js';
import { member_invitations } from '@/domains/tenancy/sub-domains/membership/member-invitation/member-invitation.schema.js';

/**
 * Invitation email-binding matrix — model `email` in
 * route-authorization-model.json. The invitation accept route is bound to the
 * invitee's email, not merely "any authenticated user": a user whose email
 * differs from the invitation cannot accept it even when holding the raw token
 * (`invitationEmailMismatch`), and the invitation stays pending. The legitimate
 * invitee (matching email) can act on it. e2e — runs in CI (Postgres + Redis).
 */
describe('Security: invitation email-binding matrix (model: email)', () => {
  let app: FastifyInstance;

  // The raw token whose SHA-256 is stored as the invitation's token_hash (the
  // raw value is normally delivered only by email). Lets the accept test reach
  // the email-binding check with a token that genuinely matches.
  const RAW_INVITATION_TOKEN = 'test-invitation-token';

  beforeAll(async () => {
    const created = await createTestApp();
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanupDatabase();
  });

  // Creates an organization with a pending invitation addressed to `inviteeEmail`
  // (tied to that user's INVITED membership), plus the invitee user record.
  async function pendingInvitationFor(inviteeEmail: string) {
    const owner = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: owner.id });
    const invitee = await createTestUser({ email: inviteeEmail });
    const role = await createRoleWithPermissions({
      organizationId: organization.id,
      permissionCodes: [],
      createdByUserId: owner.id,
    });
    const membership = await createMembership({
      userId: invitee.id,
      organizationId: organization.id,
      roleId: role.id,
      status: 'INVITED',
    });
    const [invitation] = await database
      .insert(member_invitations)
      .values({
        public_id: generatePublicId('memberInvitation'),
        membership_id: membership.id,
        email: inviteeEmail,
        token_hash: createHash('sha256').update(RAW_INVITATION_TOKEN).digest('hex'),
        invited_by_user_id: owner.id,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        created_by_user_id: owner.id,
      })
      .returning();
    return { owner, organization, invitee, membership, invitation: invitation! };
  }

  const uniqueEmail = () => `invitee-${randomUUID()}@example.test`;

  it('a user whose email differs ACCEPT with the valid token → 403 and it stays pending', async () => {
    const { invitation } = await pendingInvitationFor(uniqueEmail());
    const attacker = await createTestUser();
    const attackerToken = await generateTestToken({ userId: attacker.public_id });
    const res = await injectAuthenticated(app, {
      method: 'POST',
      url: testApiPath(`/tenancy/invitations/${invitation.public_id}/accept`),
      token: attackerToken,
      payload: { token: RAW_INVITATION_TOKEN },
    });
    expect(res.statusCode).toBe(403);
    const [row] = await database
      .select()
      .from(member_invitations)
      .where(eq(member_invitations.public_id, invitation.public_id));
    expect(row?.accepted_at).toBeNull();
  });
});
