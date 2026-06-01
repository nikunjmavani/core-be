import { THIRTY_DAYS_SECONDS } from '@/shared/constants/ttl.constants.js';

/** BullMQ queue name — repeatable schedule: `src/infrastructure/queue/scheduler.ts`. */
export const DLQ_AUTO_RETRY_QUEUE_NAME = 'dlq-auto-retry';

/** Default cron: every 15 minutes (aligned with DLQ depth sampling). */
export const DEFAULT_DLQ_AUTO_RETRY_CRON = '*/15 * * * *';

/** Redis TTL for per-row auto-retry counters (matches DLQ retention window). */
export const DLQ_AUTO_RETRY_STATE_TTL_SECONDS = THIRTY_DAYS_SECONDS;
