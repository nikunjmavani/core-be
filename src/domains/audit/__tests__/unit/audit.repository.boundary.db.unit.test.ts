import { describe, it, expect, beforeEach } from 'vitest';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { sql } from '@/infrastructure/database/connection.js';
import { AuditRepository } from '@/domains/audit/audit.repository.js';

const ACTION = 'audit.boundary.test';
const RESOURCE_TYPE = 'audit-boundary';

/**
 * Inserts a single `audit.logs` row at an explicit `created_at` for boundary assertions.
 */
async function insertAuditLogAt(actorUserId: number, createdAt: Date): Promise<number> {
  const rows = await sql<{ id: number }[]>`
    INSERT INTO audit.logs (actor_user_id, action, resource_type, resource_id, created_at)
    VALUES (
      ${actorUserId},
      ${ACTION},
      ${RESOURCE_TYPE},
      ${actorUserId},
      ${createdAt.toISOString()}::timestamptz
    )
    RETURNING id
  `;
  const idRow = rows[0];
  if (idRow === undefined) {
    throw new Error('audit log row not returned after insert');
  }
  return Number(idRow.id);
}

describe('AuditRepository.findWithFilters from/to boundary semantics (database)', () => {
  const repository = new AuditRepository();

  beforeEach(async () => {
    await cleanupDatabase();
  });

  /**
   * Use recent timestamps (e.g. one hour ago / two hours ago) for stable boundary assertions.
   */
  function buildBoundary(offsetMillis: number): Date {
    return new Date(Date.now() - offsetMillis);
  }

  it('findWithFilters includes rows at the exact from boundary (inclusive)', async () => {
    const actor = await createTestUser({ email: 'audit-boundary-from@example.com' });
    const boundary = buildBoundary(60 * 60 * 1000);
    const onBoundaryId = await insertAuditLogAt(actor.id, boundary);

    const result = await repository.findWithFilters({
      limit: 50,
      actor_user_id: actor.id,
      from: boundary.toISOString(),
    });

    const ids = result.items.map((row) => Number(row.id));
    expect(ids).toContain(onBoundaryId);
  });

  it('findWithFilters includes rows at the exact to boundary (inclusive)', async () => {
    const actor = await createTestUser({ email: 'audit-boundary-to@example.com' });
    const boundary = buildBoundary(2 * 60 * 60 * 1000);
    const onBoundaryId = await insertAuditLogAt(actor.id, boundary);

    const result = await repository.findWithFilters({
      limit: 50,
      actor_user_id: actor.id,
      to: boundary.toISOString(),
    });

    const ids = result.items.map((row) => Number(row.id));
    expect(ids).toContain(onBoundaryId);
  });

  it('findWithFilters excludes rows just outside the boundary by 1 ms', async () => {
    const actor = await createTestUser({ email: 'audit-boundary-outside@example.com' });
    const lowerBoundary = buildBoundary(4 * 60 * 60 * 1000);
    const upperBoundary = new Date(lowerBoundary.getTime() + 60 * 60 * 1000);

    const justBeforeLowerId = await insertAuditLogAt(
      actor.id,
      new Date(lowerBoundary.getTime() - 1),
    );
    const justAfterUpperId = await insertAuditLogAt(
      actor.id,
      new Date(upperBoundary.getTime() + 1),
    );
    const insideId = await insertAuditLogAt(actor.id, new Date(lowerBoundary.getTime() + 60_000));

    const result = await repository.findWithFilters({
      limit: 50,
      actor_user_id: actor.id,
      from: lowerBoundary.toISOString(),
      to: upperBoundary.toISOString(),
    });

    const ids = result.items.map((row) => Number(row.id));
    expect(ids).toContain(insideId);
    expect(ids).not.toContain(justBeforeLowerId);
    expect(ids).not.toContain(justAfterUpperId);
  });
});
