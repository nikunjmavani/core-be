/**
 * One entry of the dispatchable webhook event catalog — paired with a customer-facing
 * description used by the documentation/UI.
 */
export interface WebhookEvent {
  event: string;
  description: string;
}
