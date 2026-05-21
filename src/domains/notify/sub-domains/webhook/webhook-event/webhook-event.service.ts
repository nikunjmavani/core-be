import type { WebhookEventRepository } from './webhook-event.repository.js';

export class WebhookEventService {
  constructor(private readonly repository: WebhookEventRepository) {}

  async list() {
    return this.repository.list();
  }
}
