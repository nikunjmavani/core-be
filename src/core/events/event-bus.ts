import { AsyncLocalStorage } from 'node:async_hooks';
import {
  acknowledgeCommitDispatchTask,
  appendCommitDispatchTask,
  consumeCommitDispatchTasks,
} from '@/infrastructure/queue/commit-dispatch/commit-dispatch.store.js';
import { executeCommitDispatchTask } from '@/infrastructure/queue/commit-dispatch/commit-dispatch.executor.js';
import type { CommitDispatchTask } from '@/infrastructure/queue/commit-dispatch/commit-dispatch.types.js';
import { captureException } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';

/**
 * Envelope for an in-process domain event published through {@link eventBus}.
 * Handlers receive the event verbatim; downstream BullMQ jobs receive the
 * payload plus `requestId` for log correlation across the async boundary.
 */
export interface DomainEvent<TPayload = unknown> {
  type: string;
  payload: TPayload;
  timestamp: Date;
  /** HTTP request id when the event originated from an API request (propagated to async jobs). */
  requestId?: string;
}

/** Builds a domain event without assigning `undefined` to optional fields. */
export function buildDomainEvent<TPayload>(
  type: string,
  payload: TPayload,
  options?: { timestamp?: Date; requestId?: string },
): DomainEvent<TPayload> {
  const event: DomainEvent<TPayload> = {
    type,
    payload,
    timestamp: options?.timestamp ?? new Date(),
  };
  const requestId = options?.requestId;
  if (requestId !== undefined) {
    event.requestId = requestId;
  }
  return event;
}

/**
 * Async function registered with {@link EventBus.on}. Failures are logged but
 * never propagate — the bus catches and swallows handler errors so an
 * in-process side effect cannot fail the originating HTTP request.
 */
export type EventHandler<TPayload = unknown> = (event: DomainEvent<TPayload>) => Promise<void>;

type OnCommitTask = () => Promise<void>;

interface OnCommitQueue {
  tasks: OnCommitTask[];
}

const onCommitStorage = new AsyncLocalStorage<OnCommitQueue>();
const pendingCommitDispatchRequestIds = new Set<string>();

function getOrCreateOnCommitQueue(): OnCommitQueue {
  const existing = onCommitStorage.getStore();
  if (existing !== undefined) {
    return existing;
  }
  const queue: OnCommitQueue = { tasks: [] };
  onCommitStorage.enterWith(queue);
  return queue;
}

/**
 * In-process publish-subscribe bus for domain events. One singleton instance
 * (`eventBus`) is exported below; services emit through it and handlers
 * registered at startup react. Handler errors are caught and logged so a
 * failing handler cannot bubble up and fail the originating HTTP request.
 *
 * Pairs with `onCommit` / `flushOnCommit` for the transactional-outbox
 * pattern: side effects (BullMQ enqueues) wait until the surrounding HTTP
 * transaction commits before they fire.
 */
export class EventBus {
  private readonly handlers: Map<string, EventHandler[]> = new Map();

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Schedules work to run after the active HTTP request transaction commits (or at
   * `onResponse` for autocommit routes). Used by transactional outbox handlers to
   * dispatch BullMQ jobs only after the outbox row is durable.
   *
   * Prefer {@link scheduleCommitDispatch} for production HTTP paths — it persists
   * serializable tasks to Redis immediately so a process crash cannot drop side effects.
   */
  onCommit(task: OnCommitTask): void {
    getOrCreateOnCommitQueue().tasks.push(task);
  }

  /**
   * Runs durable Redis-backed tasks for `requestId`, then any in-memory tasks queued via
   * `onCommit` for the current async context. Call from request `onResponse` after the
   * organization RLS / statement-timeout transactions settle.
   */
  async flushOnCommit(options?: { requestId?: string }): Promise<void> {
    const requestId = options?.requestId;
    if (requestId !== undefined && pendingCommitDispatchRequestIds.has(requestId)) {
      pendingCommitDispatchRequestIds.delete(requestId);
      try {
        const durableTasks = await consumeCommitDispatchTasks({ requestId });
        for (const { task, raw } of durableTasks) {
          try {
            await executeCommitDispatchTask(task);
            // reaudit-#2: remove the durable entry ONLY after the side effect succeeded, so a
            // crash mid-batch leaves un-executed tasks for the recovery sweeper (never lost).
            await acknowledgeCommitDispatchTask({ requestId, raw });
          } catch (error) {
            logger.error({ error, requestId, task }, 'event-bus.commit-dispatch.task.failed');
            captureException(error, { requestId, tags: { source: 'event-bus.commit-dispatch' } });
          }
        }
      } catch (error) {
        logger.warn({ error, requestId }, 'commit-dispatch.consume_failed');
      }
    }

    const queue = onCommitStorage.getStore();
    if (queue === undefined || queue.tasks.length === 0) return;
    const tasks = queue.tasks.splice(0, queue.tasks.length);
    await Promise.all(
      tasks.map(async (task) => {
        try {
          await task();
        } catch (error) {
          logger.error({ error }, 'event-bus.on-commit.task.failed');
          captureException(error, { tags: { source: 'event-bus.on-commit' } });
        }
      }),
    );
  }

  /**
   * Discards the in-memory commit-dispatch marker for a request id WITHOUT running its tasks.
   *
   * @remarks
   * Call this on the request paths that deliberately skip {@link flushOnCommit} — i.e. when the
   * RLS transaction rolled back or settlement failed, so post-commit side effects must not fire.
   * Without it, the request id added by {@link scheduleCommitDispatch} would never be removed from
   * the module-level marker set (only `flushOnCommit` deletes it), leaking one string per such
   * request for the lifetime of the process. The durable Redis tasks are intentionally left for
   * the commit-dispatch recovery sweeper; only the in-memory marker is cleared here.
   */
  clearCommitDispatchMarker(requestId: string): void {
    pendingCommitDispatchRequestIds.delete(requestId);
  }

  async emit(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    if (handlers.length === 0) return;

    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          logger.error({ eventType: event.type, error }, 'Domain event handler failed');
          captureException(error, { tags: { source: 'event-bus.emit', eventType: event.type } });
        }
      }),
    );
  }

  /**
   * Like {@link emit} but propagates the first handler failure to the caller.
   * Used for auth recovery/login email paths where a silent handler failure
   * must not return success to the client.
   */
  async emitStrict(event: DomainEvent): Promise<void> {
    const handlers = this.handlers.get(event.type) ?? [];
    if (handlers.length === 0) return;

    const errors: unknown[] = [];
    await Promise.all(
      handlers.map(async (handler) => {
        try {
          await handler(event);
        } catch (error) {
          errors.push(error);
          logger.error({ eventType: event.type, error }, 'Domain event handler failed');
        }
      }),
    );
    if (errors.length > 0) {
      throw errors[0];
    }
  }
}

/** Runs `callback` with an isolated onCommit task queue (HTTP request scope). */
export function runWithOnCommitScope<T>(callback: () => Promise<T>): Promise<T> {
  return onCommitStorage.run({ tasks: [] }, callback);
}

/** Pins an empty onCommit queue for the current HTTP request (call from `onRequest`). */
export function enterOnCommitScope(): void {
  onCommitStorage.enterWith({ tasks: [] });
}

/**
 * Process-wide {@link EventBus} singleton. Services import this directly to
 * emit; handlers are registered against it at startup by
 * {@link registerEventHandlers} and the per-domain container registrations.
 */
export const eventBus = new EventBus();

/** Optional HTTP request id for {@link scheduleCommitDispatch} durable Redis persistence. */
export interface ScheduleCommitDispatchOptions {
  requestId?: string;
}

/**
 * Schedules a serializable post-commit side effect.
 *
 * @remarks
 * - **Algorithm:** when `requestId` is set, RPUSH JSON to Redis immediately; otherwise queue in-memory for flush.
 * - **Failure modes:** Redis append failure falls back to in-memory onCommit (not crash-safe).
 * - **Side effects:** may write Redis keys; execution deferred until {@link EventBus.flushOnCommit}.
 * - **Notes:** task payloads must stay secret-free — identifiers only.
 */
export async function scheduleCommitDispatch(
  task: CommitDispatchTask,
  options?: ScheduleCommitDispatchOptions,
): Promise<void> {
  const requestId = options?.requestId;
  if (requestId !== undefined) {
    try {
      await appendCommitDispatchTask({ requestId, task });
      pendingCommitDispatchRequestIds.add(requestId);
      return;
    } catch (error) {
      logger.warn(
        { error, requestId, taskType: task.type },
        'commit-dispatch.append_failed.fallback_to_memory',
      );
    }
  }
  eventBus.onCommit(() => executeCommitDispatchTask(task));
}

/**
 * Runs `callback` immediately when no HTTP onCommit scope is active (workers, scripts);
 * otherwise defers until {@link EventBus.flushOnCommit} after the request transaction commits.
 */
export async function runEnqueueAfterCommit(callback: OnCommitTask): Promise<void> {
  if (onCommitStorage.getStore() === undefined) {
    await callback();
    return;
  }
  eventBus.onCommit(callback);
}

/** Clears in-process pending markers — test harness only. */
export function resetCommitDispatchPendingStateForTests(): void {
  pendingCommitDispatchRequestIds.clear();
}
