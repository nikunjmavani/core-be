import { env } from '@/shared/config/env.config.js';

export function getWorkerConcurrencyMail(): number {
  return env.WORKER_CONCURRENCY_MAIL ?? env.WORKER_CONCURRENCY;
}

export function getWorkerConcurrencyNotify(): number {
  return env.WORKER_CONCURRENCY_NOTIFY ?? env.WORKER_CONCURRENCY;
}

export function getWorkerConcurrencyWebhook(): number {
  return env.WORKER_CONCURRENCY_WEBHOOK ?? env.WORKER_CONCURRENCY;
}

export function getWorkerConcurrencyStripe(): number {
  return env.WORKER_CONCURRENCY_STRIPE ?? env.WORKER_CONCURRENCY;
}
