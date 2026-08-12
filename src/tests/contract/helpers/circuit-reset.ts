import {
  stripeCircuit,
  s3Circuit,
  resendCircuit,
  turnstileCircuit,
} from '@/infrastructure/resilience/circuit-breaker.js';

/**
 * Reset every outbound circuit breaker so one suite's induced failures cannot trip a later one.
 *
 * @remarks
 * `turnstileCircuit` is included: leaving it out let a run of failing captcha calls hold the
 * circuit open into the next run, where `verifyTurnstileToken` catches `CircuitBreakerOpenError`
 * and reports `{ success: false }` — indistinguishable from a genuine verification failure.
 */
export async function resetOutboundServiceCircuitBreakerState(): Promise<void> {
  await Promise.all([
    stripeCircuit.reset(),
    s3Circuit.reset(),
    resendCircuit.reset(),
    turnstileCircuit.reset(),
  ]);
}
