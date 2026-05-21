import type { FastifyRequest } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableError, ValidationError } from '@/shared/errors/index.js';

const constructStripeWebhookEventMock = vi.fn();
const isStripeWebhookIngressConfiguredMock = vi.fn();

vi.mock('@/infrastructure/payment/stripe.client.js', () => ({
  constructStripeWebhookEvent: (...arguments_: unknown[]) =>
    constructStripeWebhookEventMock(...arguments_),
  isStripeWebhookIngressConfigured: () => isStripeWebhookIngressConfiguredMock(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

async function loadPreHandlerHooks(): Promise<Array<(request: FastifyRequest) => Promise<void>>> {
  const { stripeWebhookIngressPlugin } =
    await import('@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-ingress.plugin.js');

  const preHandlerHooks: Array<(request: FastifyRequest) => Promise<void>> = [];
  const application = {
    addHook: (name: string, hook: (request: FastifyRequest) => Promise<void>): void => {
      if (name === 'preHandler') {
        preHandlerHooks.push(hook);
      }
    },
  };

  await stripeWebhookIngressPlugin(application as never, {} as never);
  return preHandlerHooks;
}

describe('stripeWebhookIngressPlugin', () => {
  beforeEach(() => {
    constructStripeWebhookEventMock.mockReset();
    isStripeWebhookIngressConfiguredMock.mockReset();
    isStripeWebhookIngressConfiguredMock.mockReturnValue(true);
  });

  it('preHandler rejects when Stripe webhook ingress is not configured', async () => {
    isStripeWebhookIngressConfiguredMock.mockReturnValue(false);
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: { 'stripe-signature': 'sig_test' },
      rawBody: Buffer.from('{}'),
    } as unknown as FastifyRequest;

    await expect(preHandlerHooks[0]?.(request)).rejects.toBeInstanceOf(ServiceUnavailableError);
    expect(constructStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it('preHandler rejects missing stripe-signature', async () => {
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: {},
      rawBody: Buffer.from('{}'),
    } as unknown as FastifyRequest;

    await expect(preHandlerHooks[0]?.(request)).rejects.toBeInstanceOf(ValidationError);
    expect(constructStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it('preHandler rejects non-string stripe-signature header', async () => {
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: { 'stripe-signature': ['sig_a', 'sig_b'] as never },
      rawBody: Buffer.from('{}'),
    } as unknown as FastifyRequest;

    await expect(preHandlerHooks[0]?.(request)).rejects.toBeInstanceOf(ValidationError);
    expect(constructStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it('preHandler rejects missing raw body', async () => {
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: { 'stripe-signature': 'sig_test' },
      rawBody: undefined,
    } as unknown as FastifyRequest;

    await expect(preHandlerHooks[0]?.(request)).rejects.toBeInstanceOf(ValidationError);
    expect(constructStripeWebhookEventMock).not.toHaveBeenCalled();
  });

  it('preHandler rejects invalid signature', async () => {
    constructStripeWebhookEventMock.mockImplementation(() => {
      throw new Error('invalid signature');
    });
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: { 'stripe-signature': 'sig_bad' },
      rawBody: Buffer.from('{"id":"evt_1"}'),
    } as unknown as FastifyRequest;

    await expect(preHandlerHooks[0]?.(request)).rejects.toBeInstanceOf(ValidationError);
    expect(request.stripeWebhookEvent).toBeUndefined();
  });

  it('preHandler logs non-Error verification failures', async () => {
    constructStripeWebhookEventMock.mockImplementation(() => {
      throw 'invalid signature string';
    });
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: { 'stripe-signature': 'sig_bad' },
      rawBody: Buffer.from('{"id":"evt_1"}'),
    } as unknown as FastifyRequest;

    await expect(preHandlerHooks[0]?.(request)).rejects.toBeInstanceOf(ValidationError);
  });

  it('preHandler attaches verified event on success', async () => {
    const verifiedEvent = { id: 'evt_1', type: 'customer.created' };
    constructStripeWebhookEventMock.mockReturnValue(verifiedEvent);
    const preHandlerHooks = await loadPreHandlerHooks();

    const request = {
      headers: { 'stripe-signature': 'sig_test' },
      rawBody: Buffer.from('{"id":"evt_1"}'),
    } as unknown as FastifyRequest;

    await preHandlerHooks[0]?.(request);

    expect(constructStripeWebhookEventMock).toHaveBeenCalledWith(
      Buffer.from('{"id":"evt_1"}'),
      'sig_test',
    );
    expect(request.stripeWebhookEvent).toEqual(verifiedEvent);
  });
});
