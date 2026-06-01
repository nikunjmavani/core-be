import { env } from '@/shared/config/env.config.js';

/** Resolves the BullMQ mail-worker concurrency, falling back to `WORKER_CONCURRENCY` when no per-queue override is set. */
export function getWorkerConcurrencyMail(): number {
  return env.WORKER_CONCURRENCY_MAIL ?? env.WORKER_CONCURRENCY;
}

/** Resolves the BullMQ notification-worker concurrency, falling back to `WORKER_CONCURRENCY`. */
export function getWorkerConcurrencyNotify(): number {
  return env.WORKER_CONCURRENCY_NOTIFY ?? env.WORKER_CONCURRENCY;
}

/** Resolves the BullMQ webhook-delivery worker concurrency, falling back to `WORKER_CONCURRENCY`. */
export function getWorkerConcurrencyWebhook(): number {
  return env.WORKER_CONCURRENCY_WEBHOOK ?? env.WORKER_CONCURRENCY;
}

/** Resolves the BullMQ Stripe-webhook worker concurrency, falling back to `WORKER_CONCURRENCY`. */
export function getWorkerConcurrencyStripe(): number {
  return env.WORKER_CONCURRENCY_STRIPE ?? env.WORKER_CONCURRENCY;
}
