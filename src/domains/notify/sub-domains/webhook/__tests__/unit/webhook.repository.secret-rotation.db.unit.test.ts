import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { createTestOrganization } from '@/tests/factories/organization.factory.js';
import { WebhookRepository } from '@/domains/notify/sub-domains/webhook/webhook.repository.js';
import { webhooks } from '@/domains/notify/sub-domains/webhook/webhook.schema.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * audit-#9: the secret-rotation eligibility (overlap window) is enforced INSIDE the UPDATE
 * predicate, so concurrent rotations cannot each shift the single previous-secret slot. Exactly
 * one concurrent rotation may win; the rest return null (mapped to 409 by the service), and the
 * original secret is preserved in the previous slot rather than evicted.
 */
describe('WebhookRepository secret rotation eligibility (database — audit-#9)', () => {
  const repository = new WebhookRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('lets exactly one of several concurrent rotations win and preserves the original previous secret', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const created = await repository.create({
      organization_id: organization.id,
      url: 'https://example.com/rotate',
      encrypted_secret: 'SECRET-V1',
      events: ['webhook.test'],
      is_enabled: true,
      created_by_user_id: user.id,
    });

    // Cutoff well in the past: a never-rotated row (secret_rotated_at IS NULL) is eligible; once
    // any rotation stamps secret_rotated_at=now, every other concurrent rotation is ineligible.
    const overlapCutoff = new Date(Date.now() - 60_000);
    const results = await Promise.all(
      ['SECRET-V2', 'SECRET-V3', 'SECRET-V4'].map((secret) =>
        repository.update(
          created.public_id,
          organization.id,
          { encrypted_secret: secret },
          user.id,
          { secretRotationOverlapCutoff: overlapCutoff },
        ),
      ),
    );

    const winners = results.filter((row) => row !== null);
    expect(winners).toHaveLength(1);

    const [row] = await database
      .select({
        encrypted_secret: webhooks.encrypted_secret,
        encrypted_secret_previous: webhooks.encrypted_secret_previous,
      })
      .from(webhooks)
      .where(eq(webhooks.id, created.id));

    // The single winner shifted the ORIGINAL secret into the previous slot — never evicted by a
    // second concurrent rotation.
    expect(row!.encrypted_secret_previous).toBe('SECRET-V1');
    expect(row!.encrypted_secret).not.toBe('SECRET-V1');
  });

  it('rejects a re-rotation while still inside the overlap window (returns null → 409)', async () => {
    const user = await createTestUser();
    const organization = await createTestOrganization({ ownerUserId: user.id });
    const created = await repository.create({
      organization_id: organization.id,
      url: 'https://example.com/rotate2',
      encrypted_secret: 'SECRET-V1',
      events: ['webhook.test'],
      is_enabled: true,
      created_by_user_id: user.id,
    });

    const overlapCutoff = new Date(Date.now() - 60_000);
    const first = await repository.update(
      created.public_id,
      organization.id,
      { encrypted_secret: 'SECRET-V2' },
      user.id,
      { secretRotationOverlapCutoff: overlapCutoff },
    );
    expect(first).not.toBeNull();

    // Immediately re-rotate: secret_rotated_at is now ~now, which is NOT <= the past cutoff →
    // ineligible → null (the service surfaces this as webhookSecretRotationTooSoon / 409).
    const second = await repository.update(
      created.public_id,
      organization.id,
      { encrypted_secret: 'SECRET-V3' },
      user.id,
      { secretRotationOverlapCutoff: new Date(Date.now() - 60_000) },
    );
    expect(second).toBeNull();
  });
});
