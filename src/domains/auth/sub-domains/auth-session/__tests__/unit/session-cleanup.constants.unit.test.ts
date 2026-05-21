import { describe, it, expect } from 'vitest';
import { SESSION_CLEANUP_QUEUE_NAME } from '@/domains/auth/sub-domains/auth-session/workers/session-cleanup.constants.js';

describe('session-cleanup.constants', () => {
  it('defines the BullMQ queue name for session retention', () => {
    expect(SESSION_CLEANUP_QUEUE_NAME).toBe('session-cleanup');
  });
});
