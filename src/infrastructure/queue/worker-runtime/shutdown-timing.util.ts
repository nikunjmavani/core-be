import { FIFTEEN_SECONDS_MS, FIVE_SECONDS_MS } from '@/shared/constants/index.js';
import { env } from '@/shared/config/env.config.js';

/** Default drain budget for worker.close() and API shutdown when SHUTDOWN_TIMEOUT_MS is unset. */
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = FIFTEEN_SECONDS_MS;

/** Watchdog fires after internal timeout + buffer so in-flight drains can finish. */
export const SHUTDOWN_WATCHDOG_BUFFER_MS = FIVE_SECONDS_MS;

export function getShutdownTimeoutMs(): number {
  return env.SHUTDOWN_TIMEOUT_MS ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
}

export function getShutdownWatchdogMs(): number {
  return getShutdownTimeoutMs() + SHUTDOWN_WATCHDOG_BUFFER_MS;
}
