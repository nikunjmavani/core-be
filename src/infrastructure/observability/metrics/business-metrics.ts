import { withSystemTableWorkerContext } from '@/infrastructure/database/contexts/worker-database.context.js';
import { countPendingMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { setBusinessMetricCounts } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

/**
 * Refreshes business backlog gauges (`mail_outbox_pending`, `dlq_depth`) from Postgres
 * and BullMQ before a Prometheus scrape.
 *
 * @remarks
 * The `mail_outbox` count runs inside {@link withSystemTableWorkerContext} so the scrape
 * succeeds in the BullMQ worker process, which has no request/tenant database context — the
 * worker `/metrics` endpoint would otherwise throw `WorkerDatabaseContextError`. In the API
 * process the wrapper is a transparent pass-through, so request-path behaviour is unchanged.
 */
export async function refreshBusinessMetricsGauges(): Promise<void> {
  if (!isMetricsEnabled()) {
    return;
  }

  const [mailOutboxPending, dlqDepth] = await Promise.all([
    withSystemTableWorkerContext(() => countPendingMailOutbox()),
    getTotalDeadLetterJobCount(),
  ]);
  setBusinessMetricCounts({ mailOutboxPending, dlqDepth });
}
