import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `registerNotifyEventHandlers` is the container-path registrar — it is called from
 * `registerNotifyContainer`, not from the boot-time `register-event-handlers.ts`.
 *
 * That makes it quietly load-bearing: if the call is dropped from the container,
 * `NOTIFY_EVENT.WEBHOOK_DELIVERY_REQUESTED` stops being handled, every webhook silently stops
 * being delivered, and no existing test fails — the emit-side suites assert the event is
 * emitted, and the worker suites enqueue jobs directly.
 *
 * Each case re-imports the module graph so the module-level `registered` latches (one in the
 * aggregator, one in each child registrar) start false.
 */
describe('registerNotifyEventHandlers', () => {
  const WEBHOOK_DELIVERY_REQUESTED = 'notify.webhook_delivery.requested';
  const MEMBER_INVITATION_ACCEPTED = 'tenancy.member_invitation.accepted';

  beforeEach(() => {
    vi.resetModules();
  });

  async function loadWithSpy() {
    // Import the bus first so the spy lands on the same instance the registrars will use.
    const { eventBus } = await import('@/core/events/event-bus.js');
    const onSpy = vi.spyOn(eventBus, 'on');
    const { registerNotifyEventHandlers } = await import(
      '@/domains/notify/events/notify.event-handlers.js'
    );
    return { onSpy, registerNotifyEventHandlers };
  }

  it('subscribes the webhook-delivery-requested handler', async () => {
    const { onSpy, registerNotifyEventHandlers } = await loadWithSpy();

    registerNotifyEventHandlers();

    expect(onSpy).toHaveBeenCalledWith(WEBHOOK_DELIVERY_REQUESTED, expect.any(Function));
  });

  it('subscribes the cross-domain member-invitation-accepted handler', async () => {
    // The only cross-domain event edge in the codebase — notify consumes a tenancy event.
    const { onSpy, registerNotifyEventHandlers } = await loadWithSpy();

    registerNotifyEventHandlers();

    expect(onSpy).toHaveBeenCalledWith(MEMBER_INVITATION_ACCEPTED, expect.any(Function));
  });

  it('registers both handlers exactly once when called twice', async () => {
    // The container may be composed more than once (tests build several apps in a process);
    // double registration would deliver every webhook twice.
    const { onSpy, registerNotifyEventHandlers } = await loadWithSpy();

    registerNotifyEventHandlers();
    registerNotifyEventHandlers();
    registerNotifyEventHandlers();

    const subscribedTypes = onSpy.mock.calls.map(([eventType]) => eventType);
    expect(subscribedTypes.filter((type) => type === WEBHOOK_DELIVERY_REQUESTED)).toHaveLength(1);
    expect(subscribedTypes.filter((type) => type === MEMBER_INVITATION_ACCEPTED)).toHaveLength(1);
  });

  it('subscribes nothing until it is called', async () => {
    // Guards against a child registrar being invoked as an import side effect, which would make
    // the aggregator's idempotency latch meaningless.
    const { onSpy } = await loadWithSpy();

    expect(onSpy).not.toHaveBeenCalled();
  });

  it('is wired into the notify container', async () => {
    // The failure this file exists for: the registrar being correct but never called.
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const containerSource = readFileSync(
      join(process.cwd(), 'src/domains/notify/notify.container.ts'),
      'utf8',
    );

    expect(containerSource).toContain('registerNotifyEventHandlers');
  });
});
