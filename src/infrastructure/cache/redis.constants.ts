import { THREE_SECONDS_MS } from '@/shared/constants/index.js';

/** Tuning constants shared by the process-wide and BullMQ ioredis clients. */

/** Abort a Redis command that has not received a reply within this budget (ms). */
export const REDIS_COMMAND_TIMEOUT_MS = THREE_SECONDS_MS;

/**
 * Per-attempt step for the linear-capped Redis reconnect backoff (ms).
 *
 * @remarks
 * The reconnect delay is `min(attempt * REDIS_RECONNECT_DELAY_STEP_MS, FIVE_SECONDS_MS)`, so
 * each successive attempt waits 200 ms longer up to the five-second cap. Shared by both the
 * cache client and the dedicated BullMQ health client so their reconnect cadence stays identical.
 */
export const REDIS_RECONNECT_DELAY_STEP_MS = 200;

/**
 * RESP wire-protocol version negotiated by every ioredis client in this service.
 *
 * @remarks
 * **Why pinned:** ioredis 6 changed its default from RESP2 to RESP3. Its `replyMapping: 'legacy'`
 * default keeps reply *shapes* identical across both, so most call sites would not notice — but
 * RESP3 also moves pub/sub onto the push type and changes subscriber-mode semantics, and BullMQ
 * (an optional-peer consumer of this client's options) declares no RESP3 support. Queue traffic
 * here carries mail and billing jobs, so the protocol switch is not something to acquire as a
 * side effect of a version bump.
 *
 * **Notes:** this pins the wire protocol we already run in production, making the ioredis 6
 * upgrade a pure library change. Adopting RESP3 is a deliberate follow-up — raise this to `3`
 * only alongside a BullMQ release that states RESP3 support, and re-run the chaos + queue lanes.
 */
export const REDIS_PROTOCOL_VERSION = 2;
