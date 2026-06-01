import { countPendingMailOutbox } from '@/infrastructure/mail/mail-outbox.repository.js';
import { getTotalDeadLetterJobCount } from '@/infrastructure/observability/dlq-depth/dlq-depth.service.js';
import { isMetricsEnabled } from '@/infrastructure/observability/metrics/metrics-registry.js';
import { setBusinessMetricCounts } from '@/infrastructure/observability/metrics/prometheus-metrics.js';

/**
 * Refreshes business backlog gauges (`mail_outbox_pending`, `dlq_depth`) from Postgres
 * and BullMQ before a Prometheus scrape.
 */
export async function refreshBusinessMetricsGauges(): Promise<void> {
  if (!isMetricsEnabled()) {
    return;
  }

  const [mailOutboxPending, dlqDepth] = await Promise.all([
    countPendingMailOutbox(),
    getTotalDeadLetterJobCount(),
  ]);
  setBusinessMetricCounts({ mailOutboxPending, dlqDepth });
}
