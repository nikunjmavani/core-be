import { describe, expectTypeOf, it } from 'vitest';
import type { PostgresDatabaseHandle } from '@/infrastructure/database/utils/database-handle.types.js';
import { brandWorkerContextDatabaseHandle } from '@/infrastructure/database/utils/database-handle.types.js';
import type { WorkerDatabaseHandle } from '@/infrastructure/queue/worker-runtime/worker-processor.util.js';

describe('WorkerContextDatabaseHandle branding', () => {
  it('rejects assigning an unbranded pool handle to WorkerDatabaseHandle', () => {
    const plainHandle = {} as PostgresDatabaseHandle;
    expectTypeOf(plainHandle).not.toEqualTypeOf<WorkerDatabaseHandle>();
  });

  it('accepts a handle branded by a context wrapper', () => {
    const plainHandle = {} as PostgresDatabaseHandle;
    const branded = brandWorkerContextDatabaseHandle(plainHandle);
    expectTypeOf(branded).toEqualTypeOf<WorkerDatabaseHandle>();
  });
});
