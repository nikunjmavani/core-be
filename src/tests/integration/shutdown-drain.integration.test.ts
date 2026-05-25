import { randomUUID } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import Fastify from 'fastify';
import { Queue, Worker } from 'bullmq';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

import * as databaseConnection from '@/infrastructure/database/connection.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import * as redisClient from '@/infrastructure/cache/redis.client.js';
import { resetApplicationDrainingForTests } from '@/shared/utils/infrastructure/application-lifecycle.util.js';

function sendHttpGetRequestListeningForUrl(
  requestUrlListeningForObservation: string,
): Promise<{ statusCode: number; bodyRaw: string }> {
  return new Promise((resolve, reject) => {
    const clientRequestListeningForObservation = http.get(
      requestUrlListeningForObservation,
      (incomingMessageListeningForObservation) => {
        const responseChunksListeningForObservation: Buffer[] = [];
        incomingMessageListeningForObservation.on('data', (chunkListeningForObservation) => {
          responseChunksListeningForObservation.push(chunkListeningForObservation);
        });
        incomingMessageListeningForObservation.on('end', () => {
          resolve({
            statusCode: incomingMessageListeningForObservation.statusCode ?? 0,
            bodyRaw: Buffer.concat(responseChunksListeningForObservation).toString('utf8'),
          });
        });
      },
    );
    clientRequestListeningForObservation.on('error', reject);
  });
}

describe('graceful shutdown drain', () => {
  describe('/health/ready returns 503 while application is draining', () => {
    afterEach(() => {
      resetApplicationDrainingForTests();
      vi.restoreAllMocks();
    });

    it('returns 503 draining when the drain flag is set before the server closes', async () => {
      const { default: healthMiddleware } = await import(
        '@/shared/middlewares/health.middleware.js'
      );
      const { setApplicationDraining } = await import(
        '@/shared/utils/infrastructure/application-lifecycle.util.js'
      );

      const applicationListeningForDrainObservation = Fastify({ logger: false });
      await applicationListeningForDrainObservation.register(healthMiddleware);
      await applicationListeningForDrainObservation.ready();
      await applicationListeningForDrainObservation.listen({ port: 0, host: '127.0.0.1' });

      const addressListeningForObservation =
        applicationListeningForDrainObservation.server.address();
      if (
        addressListeningForObservation === null ||
        typeof addressListeningForObservation === 'string'
      ) {
        throw new Error('Expected server to listen on a TCP address');
      }

      const typedAddressListeningForObservation = addressListeningForObservation as AddressInfo;
      const readyUrlListeningForObservation = `http://127.0.0.1:${typedAddressListeningForObservation.port}/health/ready`;

      setApplicationDraining(true);

      const readyResponseDuringDrainListeningForObservation =
        await sendHttpGetRequestListeningForUrl(readyUrlListeningForObservation);

      expect(readyResponseDuringDrainListeningForObservation.statusCode).toBe(503);
      expect(JSON.parse(readyResponseDuringDrainListeningForObservation.bodyRaw)).toMatchObject({
        status: 'draining',
      });

      await applicationListeningForDrainObservation.close();
    }, 15_000);

    it('sets the drain flag before app.close on SIGTERM', async () => {
      const { setApplicationDraining } = await import(
        '@/shared/utils/infrastructure/application-lifecycle.util.js'
      );
      const setApplicationDrainingSpyListeningForObservation = vi.spyOn(
        await import('@/shared/utils/infrastructure/application-lifecycle.util.js'),
        'setApplicationDraining',
      );

      vi.spyOn(databaseConnection, 'closeDatabase').mockResolvedValue(undefined);
      vi.spyOn(redisClient, 'closeRedis').mockResolvedValue(undefined);
      vi.spyOn(process, 'exit').mockImplementation((() => {}) as typeof process.exit);

      const { default: shutdownMiddleware } = await import(
        '@/shared/middlewares/shutdown.middleware.js'
      );

      const applicationListeningForDrainObservation = Fastify({ logger: false });
      const applicationCloseSpyListeningForObservation = vi.spyOn(
        applicationListeningForDrainObservation,
        'close',
      );
      await applicationListeningForDrainObservation.register(shutdownMiddleware);
      await applicationListeningForDrainObservation.ready();

      process.emit('SIGTERM');
      await new Promise<void>((resolve) => setTimeout(resolve, 10));

      expect(setApplicationDrainingSpyListeningForObservation).toHaveBeenCalledWith(true);
      expect(applicationCloseSpyListeningForObservation).toHaveBeenCalled();

      setApplicationDraining(false);
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGINT');
    });
  });

  describe('in-flight HTTP request completes before app.close resolves', () => {
    afterEach(() => {
      process.removeAllListeners('SIGTERM');
      process.removeAllListeners('SIGINT');
      resetApplicationDrainingForTests();
      vi.restoreAllMocks();
    });

    it('waits for the slow handler when using a real TCP listener', async () => {
      vi.spyOn(databaseConnection, 'closeDatabase').mockResolvedValue(undefined);
      vi.spyOn(redisClient, 'closeRedis').mockResolvedValue(undefined);

      const { default: shutdownMiddleware } = await import(
        '@/shared/middlewares/shutdown.middleware.js'
      );

      const applicationListeningForDrainObservation = Fastify({ logger: false });
      let handlerCompletedAtMillisecondsListeningForObservation = 0;

      await applicationListeningForDrainObservation.register(async (instance) => {
        instance.get('/__test__/slow', async (_request, reply) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          handlerCompletedAtMillisecondsListeningForObservation = Date.now();
          return reply.send({ done: true });
        });
      });
      await applicationListeningForDrainObservation.register(shutdownMiddleware);
      await applicationListeningForDrainObservation.ready();
      await applicationListeningForDrainObservation.listen({ port: 0, host: '127.0.0.1' });

      const addressListeningForObservation =
        applicationListeningForDrainObservation.server.address();
      if (
        addressListeningForObservation === null ||
        typeof addressListeningForObservation === 'string'
      ) {
        throw new Error('Expected server to listen on a TCP address');
      }

      const typedAddressListeningForObservation = addressListeningForObservation as AddressInfo;
      const requestUrlListeningForObservation = `http://127.0.0.1:${typedAddressListeningForObservation.port}/__test__/slow`;

      const httpResponsePromiseListeningForObservation = sendHttpGetRequestListeningForUrl(
        requestUrlListeningForObservation,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      let applicationCloseResolvedAtMillisecondsListeningForObservation = 0;
      const applicationClosePromiseListeningForObservation = applicationListeningForDrainObservation
        .close()
        .finally(() => {
          applicationCloseResolvedAtMillisecondsListeningForObservation = Date.now();
        });

      await Promise.all([
        httpResponsePromiseListeningForObservation,
        applicationClosePromiseListeningForObservation,
      ]);

      const httpResponseListeningForObservation = await httpResponsePromiseListeningForObservation;

      expect(httpResponseListeningForObservation.statusCode).toBe(200);
      expect(JSON.parse(httpResponseListeningForObservation.bodyRaw)).toEqual({ done: true });
      expect(handlerCompletedAtMillisecondsListeningForObservation).toBeGreaterThan(0);
      expect(handlerCompletedAtMillisecondsListeningForObservation).toBeLessThanOrEqual(
        applicationCloseResolvedAtMillisecondsListeningForObservation,
      );
    }, 15_000);
  });

  describe('in-flight BullMQ job completes before worker.close resolves', () => {
    let queueListeningForTeardown: Queue | null = null;
    let workerListeningForTeardown: Worker | null = null;

    afterAll(async () => {
      await workerListeningForTeardown?.close();
      await queueListeningForTeardown?.close();
    });

    it('drains active jobs during worker.close()', async () => {
      const queueNameAwaitingIsolation = `shutdown-drain-${randomUUID()}`;
      let processorCompletedAtMillisecondsListeningForObservation = 0;

      const bullMqConnectionOptionsListeningForObservation = getBullMQConnectionOptions();
      workerListeningForTeardown = new Worker(
        queueNameAwaitingIsolation,
        async () => {
          await new Promise<void>((resolve) => setTimeout(resolve, 300));
          processorCompletedAtMillisecondsListeningForObservation = Date.now();
        },
        { connection: bullMqConnectionOptionsListeningForObservation, concurrency: 1 },
      );

      queueListeningForTeardown = new Queue(queueNameAwaitingIsolation, {
        connection: bullMqConnectionOptionsListeningForObservation,
        defaultJobOptions: {
          removeOnComplete: { count: 10 },
          removeOnFail: { count: 10 },
        },
      });

      await workerListeningForTeardown.waitUntilReady();
      await queueListeningForTeardown.waitUntilReady();
      await queueListeningForTeardown.add('drain', {});
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      await workerListeningForTeardown.close();
      const workerCloseResolvedAtMillisecondsListeningForObservation = Date.now();

      expect(processorCompletedAtMillisecondsListeningForObservation).toBeGreaterThan(0);
      expect(processorCompletedAtMillisecondsListeningForObservation).toBeLessThanOrEqual(
        workerCloseResolvedAtMillisecondsListeningForObservation,
      );
    });
  });
});
