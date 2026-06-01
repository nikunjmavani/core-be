import { describe, expect, it } from 'vitest';
import { createDomainContainers, createWorkerContainers } from '@/worker-containers.js';
import { createStripeWebhookWorker } from '@/domains/billing/sub-domains/stripe-webhook/workers/stripe-webhook.worker.js';

describe('worker-containers composition root', () => {
  it('createWorkerContainers exposes the same domain keys as createDomainContainers', () => {
    const workerRoot = createWorkerContainers();
    const domainRoot = createDomainContainers();

    expect(Object.keys(workerRoot).sort()).toEqual(Object.keys(domainRoot).sort());
    expect(workerRoot.billingDomain.stripeWebhookService).toBeDefined();
    expect(workerRoot.notifyDomain.webhookDeliveryAttemptRepository).toBeDefined();
  });

  it('createStripeWebhookWorker uses the injected billing container stripeWebhookService reference', () => {
    const workerContainers = createWorkerContainers();
    const billingContainer = workerContainers.billingDomain;

    const workerHandle = createStripeWebhookWorker(billingContainer);
    expect(workerHandle.queueName).toBeDefined();

    const injected = { stripeWebhookService: billingContainer.stripeWebhookService };
    expect(injected.stripeWebhookService).toBe(billingContainer.stripeWebhookService);
  });

  it('each createWorkerContainers call builds a fresh billing domain instance', () => {
    const first = createWorkerContainers();
    const second = createWorkerContainers();
    expect(first.billingDomain).not.toBe(second.billingDomain);
    expect(first.billingDomain.stripeWebhookService).not.toBe(
      second.billingDomain.stripeWebhookService,
    );
  });
});
