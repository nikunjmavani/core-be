import { z } from 'zod';

/** Optional metadata on replayed BullMQ jobs (preserved in DLQ summaries). */
export const dlqReplayJobFieldsSchema = z.object({
  replayFromDlq: z.literal(true).optional(),
  dlqReplayAttempt: z.number().int().min(0).optional(),
});

/**
 * Type for the optional `replayFromDlq` / `dlqReplayAttempt` markers attached by
 * {@link buildReplayJobPayload} when re-enqueueing a job from the dead-letter queue —
 * inferred from {@link dlqReplayJobFieldsSchema}. Mixed into per-queue job DTOs so
 * downstream workers can detect replays without losing their original payload shape.
 */
export type DlqReplayJobFields = z.infer<typeof dlqReplayJobFieldsSchema>;
