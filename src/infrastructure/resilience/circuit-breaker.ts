import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Redis } from 'ioredis';
import { redisConnection } from '@/infrastructure/cache/redis.client.js';
import { captureMessage } from '@/infrastructure/observability/sentry/sentry.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import {
  FIFTEEN_SECONDS_MS,
  MILLISECONDS_PER_MINUTE,
  MILLISECONDS_PER_SECOND,
  THIRTY_SECONDS_MS,
} from '@/shared/constants/ttl.constants.js';

/** Lifecycle state of a circuit breaker: closed (healthy), open (failing/avoided), half-open (probing recovery). */
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

interface CircuitStateData {
  state: CircuitState;
  failures: number;
  lastFailureTime: number;
  halfOpenAttempts: number;
}

const DEFAULT_STATE: CircuitStateData = {
  state: 'CLOSED',
  failures: 0,
  lastFailureTime: 0,
  halfOpenAttempts: 0,
};

type CircuitMutateCommand =
  | 'record_success'
  | 'record_failure'
  | 'attempt_half_open'
  | 'force_open';

interface CircuitBreakerOptions {
  name: string;
  redis?: Redis;
  failureThreshold?: number;
  resetTimeoutMs?: number;
  halfOpenAttempts?: number;
}

const CIRCUIT_KEY_PREFIX = 'circuit:';

const circuitMutateLua = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'lua', 'circuit-mutate.lua'),
  'utf8',
);

const redisClientsWithCircuitMutateCommand = new WeakSet<Redis>();

function ensureCircuitMutateCommand(redis: Redis): void {
  if (redisClientsWithCircuitMutateCommand.has(redis)) return;
  redis.defineCommand('circuitMutate', {
    numberOfKeys: 1,
    lua: circuitMutateLua,
  });
  redisClientsWithCircuitMutateCommand.add(redis);
}

type RedisWithCircuitMutate = Redis & {
  circuitMutate(
    key: string,
    command: CircuitMutateCommand,
    failureThreshold: number,
    maxHalfOpenAttempts: number,
    resetTimeoutMs: number,
    nowMs: number,
    callback?: (error: Error | null, result: string) => void,
  ): Promise<string>;
};

/** Thrown when a circuit is OPEN (or re-opened from half-open) — workers use {@link retryAfterMs} for BullMQ backoff. */
export class CircuitBreakerOpenError extends Error {
  readonly circuitName: string;
  readonly retryAfterMs: number;

  constructor(circuitName: string, retryAfterMs: number, message: string) {
    super(message);
    this.name = 'CircuitBreakerOpenError';
    this.circuitName = circuitName;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Redis-backed circuit breaker for external service calls (Stripe, S3, Resend).
 * State is shared across all API instances so the circuit trips cluster-wide.
 * Falls back to in-memory state when Redis is unavailable.
 *
 * Redis updates use a single `circuitMutate` Lua command (one round trip per mutation).
 */
export class CircuitBreaker {
  private readonly name: string;
  private readonly redis: Redis | undefined;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  private readonly maxHalfOpenAttempts: number;

  /** In-memory fallback when Redis get/set fails (e.g. connection error). */
  private localState: CircuitStateData = { ...DEFAULT_STATE };

  constructor(options: CircuitBreakerOptions) {
    this.name = options.name;
    this.redis = options.redis;
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeoutMs = options.resetTimeoutMs ?? THIRTY_SECONDS_MS;
    this.maxHalfOpenAttempts = options.halfOpenAttempts ?? 2;
  }

  private getKey(): string {
    return `${CIRCUIT_KEY_PREFIX}${this.name}`;
  }

  private deserializeState(raw: string): CircuitStateData {
    const data = JSON.parse(raw) as CircuitStateData;
    return {
      state: data.state,
      failures: data.failures ?? 0,
      lastFailureTime: data.lastFailureTime ?? 0,
      halfOpenAttempts: data.halfOpenAttempts ?? 0,
    };
  }

  private syncLocalFromRedis(raw: string): CircuitStateData {
    const parsed = this.deserializeState(raw);
    this.localState = parsed;
    return parsed;
  }

  private applyLocalMutation(command: CircuitMutateCommand): CircuitStateData {
    const now = Date.now();
    const previous = { ...this.localState };
    if (command === 'record_success') {
      this.localState = { ...DEFAULT_STATE };
      return this.localState;
    }
    if (command === 'record_failure') {
      const nextFailures = previous.failures + 1;
      const nextHalfOpen = previous.state === 'HALF_OPEN' ? previous.halfOpenAttempts + 1 : 0;
      let nextState: CircuitState = previous.state;
      if (
        nextFailures >= this.failureThreshold ||
        (previous.state === 'HALF_OPEN' && nextHalfOpen >= this.maxHalfOpenAttempts)
      ) {
        nextState = 'OPEN';
      }
      this.localState = {
        state: nextState,
        failures: nextFailures,
        lastFailureTime: now,
        halfOpenAttempts: nextHalfOpen,
      };
      return this.localState;
    }
    if (command === 'attempt_half_open') {
      if (previous.state !== 'OPEN') return previous;
      if (now - previous.lastFailureTime < this.resetTimeoutMs) return previous;
      this.localState = {
        state: 'HALF_OPEN',
        failures: 0,
        lastFailureTime: previous.lastFailureTime,
        halfOpenAttempts: 0,
      };
      return this.localState;
    }
    this.localState = {
      state: 'OPEN',
      failures: previous.failures,
      lastFailureTime: previous.lastFailureTime,
      halfOpenAttempts: previous.halfOpenAttempts,
    };
    return this.localState;
  }

  private async getStateFromRedis(): Promise<CircuitStateData | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(this.getKey());
      if (!raw) return null;
      return this.syncLocalFromRedis(raw);
    } catch (error) {
      logger.warn({ error, circuit: this.name }, 'circuit-breaker.redis.get.failed');
      return null;
    }
  }

  private reportMutateMetrics(latencyMs: number, fallbackLocal: boolean): void {
    logger.info(
      { circuit: this.name, latencyMs, fallbackLocal },
      fallbackLocal ? 'circuit.mutate.fallback_local_count' : 'circuit.mutate.latency_ms',
    );
    if (fallbackLocal) {
      captureMessage(`Circuit breaker "${this.name}" fell back to local state`, {
        level: 'warning',
        extra: { circuit: this.name, latencyMs, metric: 'circuit.mutate.fallback_local_count' },
      });
    }
  }

  /**
   * Atomically apply a circuit state transition via one Lua round trip.
   */
  private async mutateStateInRedis(command: CircuitMutateCommand): Promise<CircuitStateData> {
    if (!this.redis) {
      return this.applyLocalMutation(command);
    }

    const startedAt = Date.now();
    try {
      ensureCircuitMutateCommand(this.redis);
      const redisWithCommand = this.redis as RedisWithCircuitMutate;
      const raw = await redisWithCommand.circuitMutate(
        this.getKey(),
        command,
        this.failureThreshold,
        this.maxHalfOpenAttempts,
        this.resetTimeoutMs,
        Date.now(),
      );
      const next = this.syncLocalFromRedis(raw);
      this.reportMutateMetrics(Date.now() - startedAt, false);
      return next;
    } catch (error) {
      logger.warn(
        { error, circuit: this.name, command },
        'circuit-breaker.redis.unavailable.fallback_local',
      );
      const next = this.applyLocalMutation(command);
      this.reportMutateMetrics(Date.now() - startedAt, true);
      return next;
    }
  }

  private async getStateData(): Promise<CircuitStateData> {
    const fromRedis = await this.getStateFromRedis();
    if (fromRedis !== null) {
      return fromRedis;
    }
    return this.localState;
  }

  private reportCircuitStateToSentry(
    state: CircuitState,
    level: 'warning' | 'info',
    extra?: Record<string, unknown>,
  ): void {
    captureMessage(`Circuit breaker "${this.name}" state: ${state}`, {
      level,
      extra: { circuit: this.name, state, ...extra },
    });
  }

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    let data = await this.getStateData();

    if (data.state === 'OPEN') {
      const elapsed = Date.now() - data.lastFailureTime;
      if (elapsed >= this.resetTimeoutMs) {
        data = await this.mutateStateInRedis('attempt_half_open');
        logger.info({ circuit: this.name }, 'circuit-breaker.half-open');
        this.reportCircuitStateToSentry('HALF_OPEN', 'info');
      } else {
        const retryAfterMs = Math.max(this.resetTimeoutMs - elapsed, MILLISECONDS_PER_SECOND);
        throw new CircuitBreakerOpenError(
          this.name,
          retryAfterMs,
          `Circuit breaker "${this.name}" is OPEN — service unavailable`,
        );
      }
    }

    if (data.state === 'HALF_OPEN' && data.halfOpenAttempts >= this.maxHalfOpenAttempts) {
      await this.mutateStateInRedis('force_open');
      logger.warn({ circuit: this.name }, 'circuit-breaker.re-opened');
      this.reportCircuitStateToSentry('OPEN', 'warning', { reason: 'half_open_probes_failed' });
      const retryAfterMs = Math.max(
        this.resetTimeoutMs - (Date.now() - data.lastFailureTime),
        1_000,
      );
      throw new CircuitBreakerOpenError(
        this.name,
        retryAfterMs,
        `Circuit breaker "${this.name}" re-opened — half-open probes failed`,
      );
    }

    try {
      const result = await operation();
      await this.mutateStateInRedis('record_success');
      if (data.state === 'HALF_OPEN') {
        logger.info({ circuit: this.name }, 'circuit-breaker.closed');
        this.reportCircuitStateToSentry('CLOSED', 'info', { recoveredFrom: 'HALF_OPEN' });
      }
      return result;
    } catch (error) {
      const snapshot = data;
      await this.mutateStateInRedis('record_failure');
      const newState = await this.getStateData();
      if (newState.state === 'OPEN' && snapshot.state !== 'OPEN') {
        logger.warn({ circuit: this.name, failures: newState.failures }, 'circuit-breaker.open');
        this.reportCircuitStateToSentry('OPEN', 'warning', { failures: newState.failures });
      }
      throw error;
    }
  }

  async getState(): Promise<CircuitState> {
    const data = await this.getStateData();
    return data.state;
  }

  async reset(): Promise<void> {
    await this.mutateStateInRedis('record_success');
  }
}

// Pre-configured circuit breakers (Redis-backed for cluster-wide state).
// Reset windows are exported (ms) so retry callers can align BullMQ backoff with each breaker.
/** Reset window (ms) for {@link stripeCircuit}; exported so retry callers can align BullMQ backoff. */
export const STRIPE_CIRCUIT_RESET_TIMEOUT_MS = THIRTY_SECONDS_MS;
/** Reset window (ms) for {@link s3Circuit}; exported for consistent BullMQ backoff in storage workers. */
export const S3_CIRCUIT_RESET_TIMEOUT_MS = FIFTEEN_SECONDS_MS;
/** Reset window (ms) for {@link resendCircuit}; exported for mail-queue backoff alignment. */
export const RESEND_CIRCUIT_RESET_TIMEOUT_MS = MILLISECONDS_PER_MINUTE;
/** Reset window (ms) for {@link turnstileCircuit}. */
export const TURNSTILE_CIRCUIT_RESET_TIMEOUT_MS = THIRTY_SECONDS_MS;

/** Shared circuit breaker for all Stripe API calls — trips after 5 failures, half-opens after 30s. */
export const stripeCircuit = new CircuitBreaker({
  name: 'stripe',
  redis: redisConnection,
  failureThreshold: 5,
  resetTimeoutMs: STRIPE_CIRCUIT_RESET_TIMEOUT_MS,
});
/** Shared circuit breaker for all S3/object-storage calls — trips after 3 failures, half-opens after 15s. */
export const s3Circuit = new CircuitBreaker({
  name: 's3',
  redis: redisConnection,
  failureThreshold: 3,
  resetTimeoutMs: S3_CIRCUIT_RESET_TIMEOUT_MS,
});
/** Shared circuit breaker for all Resend email API calls — trips after 5 failures, half-opens after 60s. */
export const resendCircuit = new CircuitBreaker({
  name: 'resend',
  redis: redisConnection,
  failureThreshold: 5,
  resetTimeoutMs: RESEND_CIRCUIT_RESET_TIMEOUT_MS,
});
/** Shared circuit breaker for Cloudflare Turnstile CAPTCHA verification — trips after 5 failures, half-opens after 30s. */
export const turnstileCircuit = new CircuitBreaker({
  name: 'turnstile',
  redis: redisConnection,
  failureThreshold: 5,
  resetTimeoutMs: TURNSTILE_CIRCUIT_RESET_TIMEOUT_MS,
});

/** Named circuit breakers exposed to ops admin endpoints. */
export const MANAGED_CIRCUIT_BREAKERS = {
  stripe: stripeCircuit,
  s3: s3Circuit,
  resend: resendCircuit,
  turnstile: turnstileCircuit,
} as const;

/** Union of circuit breaker names exposed on ops admin endpoints. */
export type ManagedCircuitBreakerName = keyof typeof MANAGED_CIRCUIT_BREAKERS;

/** Point-in-time state of one managed external-dependency circuit breaker. */
export type ManagedCircuitBreakerSnapshot = {
  name: ManagedCircuitBreakerName;
  state: CircuitState;
};

/**
 * Reads the current state of every managed external circuit breaker (Stripe, S3, Resend,
 * Turnstile) in parallel.
 *
 * @remarks
 * Surfaces external-dependency health without issuing any outbound call — state is read from the
 * Redis-backed breaker (falling back to the in-memory copy). Shared by the ops admin endpoint and
 * the `/readyz` operational body so both report identical breaker states.
 */
export async function snapshotManagedCircuitBreakers(): Promise<ManagedCircuitBreakerSnapshot[]> {
  return Promise.all(
    Object.entries(MANAGED_CIRCUIT_BREAKERS).map(async ([name, circuitBreaker]) => ({
      name: name as ManagedCircuitBreakerName,
      state: await circuitBreaker.getState(),
    })),
  );
}
