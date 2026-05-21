/**
 * Returns whether a webhook's configured event list includes the given event type.
 */
export function webhookSubscribesToEvent(events: unknown, event_type: string): boolean {
  if (!Array.isArray(events)) return false;
  return events.some((entry) => typeof entry === 'string' && entry === event_type);
}
