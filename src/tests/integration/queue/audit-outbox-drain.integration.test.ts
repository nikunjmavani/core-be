import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { audit_outbox } from '@/domains/audit/audit-outbox.schema.js';
import { logs } from '@/domains/audit/audit.schema.js';
import {
  countPendingAuditOutboxRows,
  runAuditOutboxDrainJob,
} from '@/domains/audit/workers/audit-outbox-drain.processor.js';
import { users } from '@/domains/user/user.schema.js';
import { database } from '@/infrastructure/database/connection.js';
import { withAuditOutboxDrainDatabaseContext } from '@/infrastructure/database/contexts/audit-outbox-drain-database.context.js';
import { cleanupDatabase } from '@/tests/helpers/test-database.js';

/** Stable actor public id reused across runs (truncated by cleanupDatabase each test). */
const ACTOR_PUBLIC_ID = 'usr_auditoutboxdrain00001';

async function pendingOutboxCount(): Promise<number> {
  return withAuditOutboxDrainDatabaseContext((databaseHandle) =>
    countPendingAuditOutboxRows(databaseHandle),
  );
}

describe('Integration: audit transactional outbox drain', () => {
  beforeEach(async () => {
    await cleanupDatabase();
  });

  it('drains a PENDING tenantless row into audit.logs and empties the outbox', async () => {
    await database.insert(users).values({
      public_id: ACTOR_PUBLIC_ID,
      email: 'audit-drain@example.com',
      email_hash: 'audit-drain-hash',
    });
    await database.insert(audit_outbox).values({
      status: 'PENDING',
      actor_user_public_id: ACTOR_PUBLIC_ID,
      organization_public_id: null,
      action: 'user.login',
      resource_type: 'user',
      severity: 'INFO',
      metadata: { source: 'audit-outbox-drain.integration' },
    });

    expect(await pendingOutboxCount()).toBe(1);

    const result = await withAuditOutboxDrainDatabaseContext((databaseHandle) =>
      runAuditOutboxDrainJob(databaseHandle),
    );

    // The drain actually emptied the queue — the assertion the unused
    // countPendingAuditOutboxRows seam was written for.
    expect(result).toEqual({ drained: 1, transientFailed: 0, permanentlyFailed: 0 });
    expect(await pendingOutboxCount()).toBe(0);

    // The canonical ledger row landed with the outbox payload copied verbatim.
    const auditRows = await database.select().from(logs).where(eq(logs.action, 'user.login'));
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]?.resource_type).toBe('user');
    expect(auditRows[0]?.metadata).toEqual({ source: 'audit-outbox-drain.integration' });

    // The outbox row is marked PROCESSED (not deleted) so retention can prune it.
    const outboxRows = await database.select().from(audit_outbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.status).toBe('PROCESSED');
    expect(outboxRows[0]?.processed_at).not.toBeNull();
  });

  it('marks an unresolvable-actor row FAILED and writes no audit.logs row', async () => {
    await database.insert(audit_outbox).values({
      status: 'PENDING',
      actor_user_public_id: 'usr_doesnotexist00000001',
      organization_public_id: null,
      action: 'user.deleted',
      resource_type: 'user',
    });

    const result = await withAuditOutboxDrainDatabaseContext((databaseHandle) =>
      runAuditOutboxDrainJob(databaseHandle),
    );

    expect(result).toEqual({ drained: 0, transientFailed: 0, permanentlyFailed: 1 });
    expect(await pendingOutboxCount()).toBe(0);
    expect(await database.select().from(logs)).toHaveLength(0);

    const outboxRows = await database.select().from(audit_outbox);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]?.status).toBe('FAILED');
    expect(outboxRows[0]?.last_error).toMatch(/actor public_id did not resolve/);
  });
});
