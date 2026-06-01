import type { WebhookEventRepository } from './webhook-event.repository.js';

/**
 * Application-layer wrapper around {@link WebhookEventRepository} that exposes the catalog of
 * dispatchable webhook event types to the HTTP controller.
 *
 * @remarks
 * - **Algorithm:** delegates to the repository; the catalog is currently in-memory.
 * - **Failure modes:** none — the underlying source is a literal array.
 * - **Side effects:** none (read-only).
 * - **Notes:** kept as an explicit service so a future move to a database-backed catalog is a
 *   transparent change for callers.
 */
export class WebhookEventService {
  constructor(private readonly repository: WebhookEventRepository) {}

  async list() {
    return this.repository.list();
  }
}
