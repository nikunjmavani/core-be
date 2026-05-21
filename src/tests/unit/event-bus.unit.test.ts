import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  EventBus,
  buildDomainEvent,
  eventBus,
  enterOnCommitScope,
  runEnqueueAfterCommit,
  runWithOnCommitScope,
} from '@/core/events/event-bus.js';

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('EventBus.emit', () => {
  it('invokes registered handlers', async () => {
    const bus = new EventBus();
    let called = 0;
    bus.on('x', async () => {
      called += 1;
    });

    await bus.emit({ type: 'x', payload: { ok: true }, timestamp: new Date() });
    expect(called).toBe(1);
  });

  it('does not throw when a handler rejects (errors are swallowed and logged)', async () => {
    const bus = new EventBus();
    bus.on('boom', async () => {
      throw new Error('handler-failed');
    });

    await expect(
      bus.emit({ type: 'boom', payload: {}, timestamp: new Date() }),
    ).resolves.toBeUndefined();
  });

  it('runs all handlers even when one of them fails', async () => {
    const bus = new EventBus();
    const calls: string[] = [];
    bus.on('multi', async () => {
      calls.push('first');
    });
    bus.on('multi', async () => {
      throw new Error('second-failed');
    });
    bus.on('multi', async () => {
      calls.push('third');
    });

    await bus.emit({ type: 'multi', payload: {}, timestamp: new Date() });

    expect(calls).toContain('first');
    expect(calls).toContain('third');
  });

  it('is a no-op when no handlers are registered for a type', async () => {
    const bus = new EventBus();
    await expect(
      bus.emit({ type: 'never-registered', payload: {}, timestamp: new Date() }),
    ).resolves.toBeUndefined();
  });

  it('logs the handler error with eventType and error context', async () => {
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const bus = new EventBus();
    const handlerError = new Error('handler-x-failed');
    bus.on('log-event', async () => {
      throw handlerError;
    });

    await bus.emit({ type: 'log-event', payload: {}, timestamp: new Date() });

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'log-event', error: handlerError }),
      expect.any(String),
    );
  });
});

describe('EventBus.onCommit and flushOnCommit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('runs queued onCommit tasks in FIFO order when flushed within scope', async () => {
    const bus = new EventBus();
    const order: number[] = [];
    await runWithOnCommitScope(async () => {
      bus.onCommit(async () => {
        order.push(1);
      });
      bus.onCommit(async () => {
        order.push(2);
      });
      bus.onCommit(async () => {
        order.push(3);
      });
      await bus.flushOnCommit();
    });

    expect(order.sort()).toEqual([1, 2, 3]);
    expect(order.length).toBe(3);
  });

  it('does not throw when an onCommit task fails (logged, others still run)', async () => {
    const { logger } = await import('@/shared/utils/infrastructure/logger.util.js');
    const bus = new EventBus();
    let secondRan = false;
    await runWithOnCommitScope(async () => {
      bus.onCommit(async () => {
        throw new Error('commit-task-failed');
      });
      bus.onCommit(async () => {
        secondRan = true;
      });
      await bus.flushOnCommit();
    });

    expect(secondRan).toBe(true);
    expect(logger.error).toHaveBeenCalled();
  });

  it('flushOnCommit is a no-op outside an onCommit scope', async () => {
    const bus = new EventBus();
    await expect(bus.flushOnCommit()).resolves.toBeUndefined();
  });

  it('flushOnCommit clears the queue so a second flush is a no-op', async () => {
    const bus = new EventBus();
    let runs = 0;
    await runWithOnCommitScope(async () => {
      bus.onCommit(async () => {
        runs += 1;
      });
      await bus.flushOnCommit();
      await bus.flushOnCommit();
    });
    expect(runs).toBe(1);
  });

  it('runWithOnCommitScope isolates parent and nested queues', async () => {
    const parentTasks: string[] = [];
    const childTasks: string[] = [];

    await runWithOnCommitScope(async () => {
      eventBus.onCommit(async () => {
        parentTasks.push('parent');
      });

      await runWithOnCommitScope(async () => {
        eventBus.onCommit(async () => {
          childTasks.push('child');
        });
        await eventBus.flushOnCommit();
      });

      // Child flush should not have touched parent queue
      expect(parentTasks).toHaveLength(0);
      expect(childTasks).toEqual(['child']);

      await eventBus.flushOnCommit();
    });

    expect(parentTasks).toEqual(['parent']);
  });

  it('enterOnCommitScope pins an empty queue and clears prior tasks for the current async context', async () => {
    let ran = 0;
    // Run a separate AsyncLocalStorage scope so the enterOnCommitScope reset is isolated
    await runWithOnCommitScope(async () => {
      eventBus.onCommit(async () => {
        ran += 1;
      });
      // Pin a fresh queue — this drops the pending task
      enterOnCommitScope();
      await eventBus.flushOnCommit();
    });
    expect(ran).toBe(0);
  });
});

describe('runEnqueueAfterCommit', () => {
  it('runs the callback immediately when no onCommit scope is active', async () => {
    let ran = false;
    await runEnqueueAfterCommit(async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });

  it('defers the callback to flushOnCommit when inside a scope', async () => {
    let ran = false;
    await runWithOnCommitScope(async () => {
      await runEnqueueAfterCommit(async () => {
        ran = true;
      });
      expect(ran).toBe(false); // deferred
      await eventBus.flushOnCommit();
    });
    expect(ran).toBe(true);
  });
});

describe('buildDomainEvent', () => {
  it('builds an event with a default timestamp', () => {
    const event = buildDomainEvent('domain.foo', { a: 1 });
    expect(event.type).toBe('domain.foo');
    expect(event.payload).toEqual({ a: 1 });
    expect(event.timestamp).toBeInstanceOf(Date);
    expect(event.requestId).toBeUndefined();
  });

  it('includes requestId only when provided', () => {
    const event = buildDomainEvent('domain.foo', { a: 1 }, { requestId: 'req-1' });
    expect(event.requestId).toBe('req-1');
  });

  it('does not assign requestId when options omit requestId', () => {
    const event = buildDomainEvent('domain.foo', { a: 1 }, {});
    expect('requestId' in event).toBe(false);
  });

  it('uses the provided timestamp when given', () => {
    const fixedTime = new Date('2026-01-01T00:00:00Z');
    const event = buildDomainEvent('domain.bar', {}, { timestamp: fixedTime });
    expect(event.timestamp).toBe(fixedTime);
  });
});
