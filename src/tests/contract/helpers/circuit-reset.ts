import {
  stripeCircuit,
  s3Circuit,
  resendCircuit,
} from '@/infrastructure/resilience/circuit-breaker.js';

export async function resetOutboundServiceCircuitBreakerState(): Promise<void> {
  await Promise.all([stripeCircuit.reset(), s3Circuit.reset(), resendCircuit.reset()]);
}
