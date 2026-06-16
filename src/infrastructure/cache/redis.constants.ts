/** Tuning constants shared by the process-wide and BullMQ ioredis clients. */

/** Abort a Redis command that has not received a reply within this budget (ms). */
export const REDIS_COMMAND_TIMEOUT_MS = 3_000;

/**
 * Per-attempt step for the linear-capped Redis reconnect backoff (ms).
 *
 * @remarks
 * The reconnect delay is `min(attempt * REDIS_RECONNECT_DELAY_STEP_MS, FIVE_SECONDS_MS)`, so
 * each successive attempt waits 200 ms longer up to the five-second cap. Shared by both the
 * cache client and the dedicated BullMQ health client so their reconnect cadence stays identical.
 */
export const REDIS_RECONNECT_DELAY_STEP_MS = 200;
