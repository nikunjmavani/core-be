import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { STRIPE_WEBHOOK_QUEUE_NAME } from '@/domains/billing/sub-domains/stripe-webhook/queues/stripe-webhook.queue.js';
import { NOTIFICATION_QUEUE_NAME } from '@/domains/notify/sub-domains/notification/queues/notification.queue.js';
import {
  resendCircuit,
  stripeCircuit,
  type CircuitBreaker,
} from '@/infrastructure/resilience/circuit-breaker.js';

const SOURCE_QUEUE_TO_CIRCUIT: Readonly<Record<string, CircuitBreaker>> = {
  [MAIL_QUEUE_NAME]: resendCircuit,
  [NOTIFICATION_QUEUE_NAME]: resendCircuit,
  [STRIPE_WEBHOOK_QUEUE_NAME]: stripeCircuit,
};

/**
 * Returns whether the cluster-wide outbound circuit for a replayable source queue is CLOSED.
 *
 * @remarks
 * - **Algorithm:** maps mail/notification → Resend, stripe-webhook → Stripe; webhook-delivery
 *   has no shared Redis circuit (per-webhook opossum breakers) and is always treated as closed.
 * - **Failure modes:** relies on {@link CircuitBreaker.getState} Redis fallback semantics.
 * - **Side effects:** read-only Redis GET on the circuit key.
 * - **Notes:** HALF_OPEN and OPEN both block automated replay so probes are not amplified.
 */
export async function isDeadLetterSourceQueueCircuitClosed(sourceQueue: string): Promise<boolean> {
  const circuit = SOURCE_QUEUE_TO_CIRCUIT[sourceQueue];
  if (!circuit) return true;
  const state = await circuit.getState();
  return state === 'CLOSED';
}
