/**
 * Lists failed Stripe webhook ledger rows and optionally reclaims them for worker retry.
 *
 * Usage:
 *   pnpm stripe:webhook:replay -- --list
 *   pnpm stripe:webhook:replay -- --reclaim evt_123 [--dry-run]
 *
 * Run: pnpm stripe:webhook:replay
 */
import { eq } from 'drizzle-orm';
import { database } from '@/infrastructure/database/connection.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { stripe_webhook_events } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook.schema.js';
import { StripeWebhookEventRepository } from '@/domains/billing/sub-domains/stripe-webhook/stripe-webhook-event.repository.js';

const repository = new StripeWebhookEventRepository();

async function listFailedEvents(): Promise<void> {
  const rows = await database
    .select({
      stripe_event_id: stripe_webhook_events.stripe_event_id,
      event_type: stripe_webhook_events.event_type,
      attempt_count: stripe_webhook_events.attempt_count,
      failure_reason: stripe_webhook_events.failure_reason,
      updated_at: stripe_webhook_events.updated_at,
    })
    .from(stripe_webhook_events)
    .where(eq(stripe_webhook_events.processing_status, 'failed'));

  if (rows.length === 0) {
    console.log('No failed Stripe webhook events.');
    return;
  }

  for (const row of rows) {
    console.log(
      `${row.stripe_event_id}\t${row.event_type}\tattempts=${row.attempt_count}\t${row.failure_reason ?? ''}`,
    );
  }
  console.log(`Total failed: ${rows.length}`);
}

async function reclaimEvent(stripeEventId: string, dryRun: boolean): Promise<void> {
  if (dryRun) {
    console.log(`[dry-run] Would reclaim ${stripeEventId}`);
    return;
  }

  const reclaimed = await repository.tryReclaimEvent(stripeEventId);
  if (reclaimed) {
    console.log(`Reclaimed ${stripeEventId} — enqueue a stripe-webhook job to process.`);
  } else {
    console.log(`Could not reclaim ${stripeEventId} (not failed or not stuck processing).`);
  }
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const dryRun = argumentsList.includes('--dry-run');

  if (argumentsList.includes('--list') || argumentsList.length === 0) {
    await listFailedEvents();
    return;
  }

  const reclaimIndex = argumentsList.indexOf('--reclaim');
  if (reclaimIndex >= 0) {
    const stripeEventId = argumentsList[reclaimIndex + 1];
    if (!stripeEventId || stripeEventId.startsWith('--')) {
      console.error('Usage: pnpm stripe:webhook:replay -- --reclaim <stripe_event_id> [--dry-run]');
      process.exitCode = 1;
      return;
    }
    await reclaimEvent(stripeEventId, dryRun);
    return;
  }

  console.error('Usage: pnpm stripe:webhook:replay -- --list | --reclaim <id> [--dry-run]');
  process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDatabase();
  });
