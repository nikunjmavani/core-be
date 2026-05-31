import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CommitDispatchTask } from '@/infrastructure/queue/commit-dispatch/commit-dispatch.types.js';

const redisMock = {
  multi: vi.fn(),
  lrange: vi.fn(),
  del: vi.fn(),
  zrem: vi.fn(),
  zrangebyscore: vi.fn(),
};

vi.mock('@/infrastructure/cache/redis.client.js', () => ({
  redisConnection: redisMock,
}));

describe('commit-dispatch.store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.multi.mockReturnValue({
      rpush: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      zadd: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    });
  });

  it('appendCommitDispatchTask writes to Redis list and recovery index', async () => {
    const { appendCommitDispatchTask } = await import(
      '@/infrastructure/queue/commit-dispatch/commit-dispatch.store.js'
    );
    const task: CommitDispatchTask = { type: 'mail_outbox', mailOutboxId: 42 };

    await appendCommitDispatchTask({ requestId: 'req-1', task });

    const multi = redisMock.multi.mock.results[0]?.value;
    expect(multi.rpush).toHaveBeenCalledWith('commit-dispatch:pending:req-1', JSON.stringify(task));
    expect(multi.zadd).toHaveBeenCalledWith(
      'commit-dispatch:recovery',
      expect.any(Number),
      'req-1',
    );
  });

  it('consumeCommitDispatchTasks parses and clears durable tasks', async () => {
    const task: CommitDispatchTask = {
      type: 'notification',
      notificationId: 7,
      organizationPublicId: 'org_abc',
    };
    redisMock.lrange.mockResolvedValue([JSON.stringify(task)]);

    const { consumeCommitDispatchTasks } = await import(
      '@/infrastructure/queue/commit-dispatch/commit-dispatch.store.js'
    );
    const tasks = await consumeCommitDispatchTasks({ requestId: 'req-2' });

    expect(tasks).toEqual([task]);
    expect(redisMock.del).toHaveBeenCalledWith('commit-dispatch:pending:req-2');
    expect(redisMock.zrem).toHaveBeenCalledWith('commit-dispatch:recovery', 'req-2');
  });
});
