import type { WebhookEvent } from './webhook-event.types.js';

/**
 * Static catalog of webhook event types that the platform can dispatch.
 *
 * This nested sub-domain intentionally omits `*.dto.ts`, `*.validator.ts`, and `*.schema.ts`:
 *   - the only route (`GET /webhook-events`) accepts no params or body, so there is nothing to validate;
 *   - the catalog has no database table — entries live here and are emitted by the producing domains.
 * If the catalog ever moves to the database, add a schema and (if relevant) a query DTO/validator.
 */
const AVAILABLE_WEBHOOK_EVENTS: WebhookEvent[] = [
  { event: 'organization.created', description: 'When an organization is created' },
  { event: 'organization.updated', description: 'When an organization is updated' },
  { event: 'membership.created', description: 'When a membership is created' },
  { event: 'membership.updated', description: 'When a membership is updated' },
  { event: 'membership.deleted', description: 'When a membership is deleted' },
  { event: 'subscription.created', description: 'When a subscription is created' },
  { event: 'subscription.updated', description: 'When a subscription is updated' },
  { event: 'subscription.cancelled', description: 'When a subscription is cancelled' },
];

/**
 * In-memory repository over the static {@link AVAILABLE_WEBHOOK_EVENTS} catalog. Wraps the
 * literal array so the public surface stays a `Repository` and a future migration to a database
 * table is a drop-in change for callers.
 */
export class WebhookEventRepository {
  async list(): Promise<WebhookEvent[]> {
    return [...AVAILABLE_WEBHOOK_EVENTS];
  }
}
