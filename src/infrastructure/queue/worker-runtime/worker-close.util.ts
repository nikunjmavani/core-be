import type { Worker } from 'bullmq';
import type { WorkerHandle } from '@/infrastructure/queue/bootstrap.js';
import { getShutdownTimeoutMs } from '@/infrastructure/queue/worker-runtime/shutdown-timing.util.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/** Bounded close for bootstrap handles; falls back to handle.close() for scheduler-only handles. */
export async function closeWorkerHandle(handle: WorkerHandle): Promise<void> {
  if (handle.worker !== undefined && handle.queueName !== undefined) {
    await closeWorkerWithTimeout(handle.worker, { queueName: handle.queueName });
    return;
  }
  await handle.close();
}

export async function closeWorkerWithTimeout(
  worker: Worker,
  options?: { timeoutMs?: number; queueName?: string },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? getShutdownTimeoutMs();
  const queueName = options?.queueName ?? worker.name;

  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      worker.close(),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(`worker.close exceeded ${String(timeoutMs)}ms for queue ${queueName}`));
        }, timeoutMs);
      }),
    ]);
  } catch (error) {
    const isTimeout = error instanceof Error && error.message.includes('worker.close exceeded');
    if (isTimeout) {
      logger.warn({ queueName, timeoutMs, error }, 'worker.shutdown.timeout');
    } else {
      logger.warn({ queueName, timeoutMs, error }, 'worker.close.timeout_or_error');
    }
    throw error;
  } finally {
    if (timeoutHandle !== undefined) {
      clearTimeout(timeoutHandle);
    }
  }
}

export function buildWorkerHandle(worker: Worker, queueName: string): WorkerHandle {
  return {
    worker,
    queueName,
    close: async () => closeWorkerWithTimeout(worker, { queueName }),
  };
}
