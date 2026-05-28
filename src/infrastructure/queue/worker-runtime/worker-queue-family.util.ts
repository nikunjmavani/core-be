import { env } from '@/shared/config/env.config.js';
import {
  WORKER_QUEUE_FAMILIES_ALL_TOKEN,
  WORKER_QUEUE_FAMILY_NAMES,
  type WorkerQueueFamily,
} from '@/infrastructure/queue/worker-runtime/worker-queue-family.constants.js';

const WORKER_QUEUE_FAMILY_SET = new Set<string>(WORKER_QUEUE_FAMILY_NAMES);

/**
 * Parses `WORKER_QUEUE_FAMILIES` (comma-separated). Unset or `all` selects every family.
 */
export function parseWorkerQueueFamilies(rawValue: string | undefined): WorkerQueueFamily[] {
  const trimmed = rawValue?.trim();
  if (
    trimmed === undefined ||
    trimmed.length === 0 ||
    trimmed === WORKER_QUEUE_FAMILIES_ALL_TOKEN
  ) {
    return [...WORKER_QUEUE_FAMILY_NAMES];
  }

  const tokens = trimmed
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter((token) => token.length > 0);

  if (tokens.length === 0) {
    return [...WORKER_QUEUE_FAMILY_NAMES];
  }

  if (tokens.includes(WORKER_QUEUE_FAMILIES_ALL_TOKEN)) {
    return [...WORKER_QUEUE_FAMILY_NAMES];
  }

  const selected: WorkerQueueFamily[] = [];
  for (const token of tokens) {
    if (!WORKER_QUEUE_FAMILY_SET.has(token)) {
      throw new Error(
        `Invalid WORKER_QUEUE_FAMILIES token "${token}". Allowed: ${WORKER_QUEUE_FAMILIES_ALL_TOKEN} or ${WORKER_QUEUE_FAMILY_NAMES.join(', ')}`,
      );
    }
    const family = token as WorkerQueueFamily;
    if (!selected.includes(family)) {
      selected.push(family);
    }
  }

  return selected;
}

/** Resolves the queue families this worker process should run by parsing `env.WORKER_QUEUE_FAMILIES`. */
export function getSelectedWorkerQueueFamilies(): WorkerQueueFamily[] {
  return parseWorkerQueueFamilies(env.WORKER_QUEUE_FAMILIES);
}

/** True when every queue family runs in this worker process (monolithic worker). */
export function isMonolithicWorkerQueueFamilies(families: readonly WorkerQueueFamily[]): boolean {
  return families.length === WORKER_QUEUE_FAMILY_NAMES.length;
}
