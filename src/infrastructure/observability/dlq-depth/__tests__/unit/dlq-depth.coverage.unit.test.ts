import { describe, it, expect } from 'vitest';
import { SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { getWorkerQueueRegistrationDefinitions } from '@/infrastructure/queue/worker-runtime/worker-registration.registry.js';

describe('DLQ-depth monitoring coverage (reaudit-#5)', () => {
  it('samples the DLQ of every retention-family worker (no silent dead-letter)', () => {
    const monitored = new Set<string>(SOURCE_QUEUE_NAMES_FOR_DLQ_MONITORING);
    const retentionQueues = getWorkerQueueRegistrationDefinitions()
      .filter((definition) => definition.family === 'retention')
      .map((definition) => definition.queueName);

    const missing = retentionQueues.filter((queueName) => !monitored.has(queueName));
    expect(missing).toEqual([]);
  });
});
