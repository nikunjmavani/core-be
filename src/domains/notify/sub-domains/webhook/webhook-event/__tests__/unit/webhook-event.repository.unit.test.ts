import { describe, expect, it } from 'vitest';
import { WebhookEventRepository } from '@/domains/notify/sub-domains/webhook/webhook-event/webhook-event.repository.js';

/**
 * The catalog behind `GET /notify/webhook-events`.
 *
 * Its sibling `webhook.repository.ts` has four test files; this one had none. The catalog is an
 * in-memory literal today, so the cases that matter are the ones that would survive the
 * documented future migration to a database table: the shape of every entry, and — most
 * importantly — that `list()` hands back a **copy**, so a caller mutating the returned array
 * cannot corrupt the catalog for every subsequent request in the process.
 */
describe('WebhookEventRepository', () => {
  const repository = new WebhookEventRepository();

  it('lists the catalog with every entry carrying an event and a description', async () => {
    const events = await repository.list();

    expect(events.length).toBeGreaterThan(0);
    for (const entry of events) {
      expect(entry.event).toEqual(expect.any(String));
      expect(entry.event.length).toBeGreaterThan(0);
      expect(entry.description).toEqual(expect.any(String));
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it('exposes only the public event and description fields', async () => {
    const [entry] = await repository.list();

    // The serializer strips unknown fields, but the catalog is also the OpenAPI source of
    // truth — an internal field added here would leak into the published contract.
    expect(Object.keys(entry ?? {}).sort()).toEqual(['description', 'event']);
  });

  it('returns event names in the dotted resource.action form', async () => {
    const events = await repository.list();

    for (const entry of events) {
      expect(entry.event).toMatch(/^[a-z]+(?:_[a-z]+)*\.[a-z]+$/);
    }
  });

  it('contains no duplicate event names', async () => {
    const events = await repository.list();
    const names = events.map((entry) => entry.event);

    expect(new Set(names).size).toBe(names.length);
  });

  it('returns a defensive copy — mutating the result cannot corrupt the catalog', async () => {
    // list() spreads the module-level array. Without the spread, a caller doing
    // `events.pop()` (or a serializer sorting in place) would permanently shrink or reorder
    // the catalog for the lifetime of the process.
    const first = await repository.list();
    const originalLength = first.length;
    first.pop();
    first.push({ event: 'injected.event', description: 'injected' });

    const second = await repository.list();
    expect(second).toHaveLength(originalLength);
    expect(second.map((entry) => entry.event)).not.toContain('injected.event');
  });

  it('returns a stable order across calls', async () => {
    // The serializer preserves list order, so the catalog order is the API response order.
    const first = await repository.list();
    const second = await repository.list();

    expect(second.map((entry) => entry.event)).toEqual(first.map((entry) => entry.event));
  });
});
