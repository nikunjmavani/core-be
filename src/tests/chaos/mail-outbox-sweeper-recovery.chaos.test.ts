import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { FastifyInstance } from 'fastify';
import { Queue } from 'bullmq';
import { eq, sql as drizzleSql } from 'drizzle-orm';

import { CHAOS_REDIS_PROXY_NAME } from '@/tests/chaos/chaos.constants.js';
import {
  resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy,
  withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion,
} from '@/tests/chaos/helpers/toxiproxy.client.js';
import { createListeningChaosTestApplicationHarness } from '@/tests/chaos/helpers/chaos-app.js';
import { createTestUser } from '@/tests/factories/user.factory.js';
import { database } from '@/infrastructure/database/connection.js';
import { mail_outbox } from '@/infrastructure/mail/mail-outbox.schema.js';
import { MAIL_QUEUE_NAME } from '@/infrastructure/mail/queues/mail.queue.js';
import { runMailOutboxSweeperJob } from '@/infrastructure/mail/workers/mail-outbox-sweeper.processor.js';
import { getBullMQConnectionOptions } from '@/infrastructure/queue/connection.js';
import { env } from '@/shared/config/env.config.js';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';

/**
 * The RECOVERY half of the transactional-outbox story. `redis-queue-enqueue` already
 * proves the outage half (user-visible 200 while post-commit dispatch fails); this test
 * proves the platform actually heals: the durable `auth.mail_outbox` row survives the
 * Redis outage, and once Redis is back a sweeper pass re-enqueues it onto the mail
 * queue. Without this, an outage would silently strand every email recorded during it.
 */
describe('Chaos resilience: mail outbox sweeper drains rows stranded by a Redis outage', () => {
  let chaosListeningFastifyApplication: FastifyInstance;

  beforeAll(async () => {
    const harnessForOutboxRecoveryObservation = await createListeningChaosTestApplicationHarness();
    chaosListeningFastifyApplication =
      harnessForOutboxRecoveryObservation.chaosApplicationListeningInstance;
  });

  afterAll(async () => {
    await chaosListeningFastifyApplication.close();
    await resetChaosTestingListeningProxyFailuresGloballyViaToxiproxy();
  });

  it('re-enqueues the stranded outbox row after Redis connectivity is restored', async () => {
    const userAwaitingStrandedVerificationEmail = await createTestUser({
      email: `chaos-outbox-sweeper-${randomUUID()}@example.com`,
    });

    // Phase 1 — outage: the request succeeds, the outbox row is durably recorded in
    // Postgres, and the BullMQ dispatch fails (Redis is administratively unreachable).
    await withTemporaryListeningProxyAdministrativelyDisabledForChaosAssertion(
      CHAOS_REDIS_PROXY_NAME,
      async () => {
        const sendCodeResponseDuringRedisOutage = await chaosListeningFastifyApplication.inject({
          method: 'POST',
          url: testApiPath('/auth/email/send-code'),
          payload: JSON.stringify({ email: userAwaitingStrandedVerificationEmail.email }),
          headers: { 'content-type': 'application/json' },
        });
        expect(sendCodeResponseDuringRedisOutage.statusCode).toBe(200);
      },
    );

    const [strandedOutboxRowAwaitingSweep] = await database
      .select({ id: mail_outbox.id, status: mail_outbox.status })
      .from(mail_outbox)
      .where(
        drizzleSql`${mail_outbox.to_addresses}::text LIKE ${`%${userAwaitingStrandedVerificationEmail.email}%`}`,
      )
      .limit(1);

    expect(strandedOutboxRowAwaitingSweep).toBeDefined();
    expect(strandedOutboxRowAwaitingSweep!.status).toBe('pending');

    // Phase 2 — recovery: backdate the row past the sweep cutoff (the sweeper only
    // touches rows older than MAIL_OUTBOX_SWEEP_PENDING_MINUTES so it never races the
    // happy-path dispatch), then run one sweeper pass with Redis healthy again.
    const minutesBeyondSweepCutoff = env.MAIL_OUTBOX_SWEEP_PENDING_MINUTES + 1;
    await database
      .update(mail_outbox)
      .set({
        created_at: drizzleSql`NOW() - make_interval(mins => ${minutesBeyondSweepCutoff})`,
        updated_at: drizzleSql`NOW() - make_interval(mins => ${minutesBeyondSweepCutoff})`,
      })
      .where(eq(mail_outbox.id, strandedOutboxRowAwaitingSweep!.id));

    const sweeperPassResultAfterRecovery = await runMailOutboxSweeperJob();
    expect(sweeperPassResultAfterRecovery.reEnqueuedCount).toBeGreaterThanOrEqual(1);

    // The stranded row's id is now a live job on the mail queue — the mail worker (not
    // running here) would claim and send it. Scan a bounded window of queue states so a
    // leftover job from another suite cannot mask a missing re-enqueue.
    const mailQueueHandleForRecoveryAssertion = new Queue(MAIL_QUEUE_NAME, {
      connection: getBullMQConnectionOptions(),
    });
    try {
      const enqueuedMailJobsAfterSweep = await mailQueueHandleForRecoveryAssertion.getJobs(
        ['waiting', 'delayed', 'active', 'prioritized'],
        0,
        200,
      );
      const reEnqueuedJobForStrandedRow = enqueuedMailJobsAfterSweep.find(
        (job) =>
          (job.data as { mailOutboxId?: number }).mailOutboxId ===
          strandedOutboxRowAwaitingSweep!.id,
      );
      expect(reEnqueuedJobForStrandedRow).toBeDefined();
    } finally {
      await mailQueueHandleForRecoveryAssertion.close();
    }
  });
});
