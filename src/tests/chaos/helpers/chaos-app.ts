import { buildApp } from '@/app.js';
import type { FastifyInstance } from 'fastify';

/**
 * Build a chaos-mode Fastify instance for HTTP observation via `application.inject()`.
 *
 * Mirrors {@link '@/tests/helpers/test-app.js#createTestApp} but documents intent for reviewers.
 */
export async function createListeningChaosTestApplicationHarness(): Promise<{
  chaosApplicationListeningInstance: FastifyInstance;
}> {
  const chaosApplicationListeningInstance = await buildApp();
  await chaosApplicationListeningInstance.ready();
  return {
    chaosApplicationListeningInstance,
  };
}
