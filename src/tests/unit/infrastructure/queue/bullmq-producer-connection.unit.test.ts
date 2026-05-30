import { describe, expect, it } from 'vitest';
import {
  getBullMQConnectionOptions,
  getBullMQProducerConnectionOptions,
} from '@/infrastructure/queue/connection.js';

describe('getBullMQProducerConnectionOptions', () => {
  it('pins enableOfflineQueue: false so producers fail fast during a Redis partition', () => {
    const options = getBullMQProducerConnectionOptions();
    expect(options.enableOfflineQueue).toBe(false);
  });

  it('inherits every base BullMQ connection option (host/port/db/family/retries/prefix)', () => {
    const base = getBullMQConnectionOptions();
    const producer = getBullMQProducerConnectionOptions();
    // The producer options are the base options plus the fail-fast flag — nothing else changes,
    // so workers and producers resolve the same Redis target and key prefix.
    expect(producer).toMatchObject(base);
    expect(producer.maxRetriesPerRequest).toBeNull();
  });
});
