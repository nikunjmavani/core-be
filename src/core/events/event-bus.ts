import { AsyncLocalStorage } from 'node:async_hooks';
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
  private handlers: Map<string, EventHandler[]> = new Map();

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  /**
   * Schedules work to run after the active HTTP request transaction commits (or at
   * `onResponse` for autocommit routes). Used by transactional outbox handlers to
   * dispatch BullMQ jobs only after the outbox row is durable.
   */
  onCommit(task: OnCommitTask): void {
    getOrCreateOnCommitQueue().tasks.push(task);
  }

  /**
   * Runs all tasks queued via `onCommit` for the current async context since the last flush.
   * Call from request `onResponse` after organization RLS / statement-timeout transactions settle.
   */
  async flushOnCommit(): Promise<void> {
    const queue = onCommitStorage.getStore();
    if (queue === undefined || queue.tasks.length === 0) return;
    const tasks = queue.tasks.splice(0, queue.tasks.length);
    await Promise.all(
      tasks.map(async (task) => {
        try {
          await task();
        } catch (error) {
          logger.error({ error }, 'event-bus.on-commit.task.failed');
        }
      }),
    );
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
        }
      }),
    );
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
