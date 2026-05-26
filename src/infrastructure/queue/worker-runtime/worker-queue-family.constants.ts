/**
 * BullMQ worker queue families for split worker services and Postgres pool budgeting.
 * Comma-separated `WORKER_QUEUE_FAMILIES` selects which families a process runs.
 */
export const WORKER_QUEUE_FAMILY_NAMES = [
  'mail',
  'notify',
  'webhook',
  'stripe',
  'retention',
  'observability',
] as const;

export type WorkerQueueFamily = (typeof WORKER_QUEUE_FAMILY_NAMES)[number];

export const WORKER_QUEUE_FAMILIES_ALL_TOKEN = 'all' as const;
