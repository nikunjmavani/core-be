import { describe, it, expect } from 'vitest';
import {
  acquireResourceQuotaLock,
  RESOURCE_QUOTA_LOCK_NAMESPACE,
} from '@/infrastructure/database/resource-quota-lock.util.js';

/**
 * B-1 regression — the advisory-lock `objid` was cast `::int`, so a `bigserial` scope id beyond
 * int4's 2,147,483,647 max threw "integer out of range" and would have broken the create/quota
 * path entirely once any id sequence crossed ~2.1B. The `objid` is now a positive int4 hash of the
 * key (`hashtextextended(key) & 0x7fffffff`), so any bigint id locks without overflow. Outside an
 * explicit transaction each call auto-commits, releasing the xact lock immediately — the assertion
 * is simply that the statement executes without an int4-range error.
 */
describe('acquireResourceQuotaLock — bigint scope id (B-1)', () => {
  it('locks without int4 overflow for a scope id beyond 2^31', async () => {
    const beyondInt4 = 3_000_000_000; // > 2,147,483,647 (int4 max)
    await expect(
      acquireResourceQuotaLock(RESOURCE_QUOTA_LOCK_NAMESPACE.WEBHOOK, beyondInt4),
    ).resolves.toBeUndefined();
  });

  it('locks without overflow for a very large bigint scope id', async () => {
    const largeBigint = 9_000_000_000_000; // far beyond int4, well within int8/bigserial
    await expect(
      acquireResourceQuotaLock(RESOURCE_QUOTA_LOCK_NAMESPACE.MEMBER_ROLE, largeBigint),
    ).resolves.toBeUndefined();
  });
});
