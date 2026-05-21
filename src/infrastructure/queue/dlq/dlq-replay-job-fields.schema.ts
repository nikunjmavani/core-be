import { z } from 'zod';

/** Optional metadata on replayed BullMQ jobs (preserved in DLQ summaries). */
export const dlqReplayJobFieldsSchema = z.object({
  replayFromDlq: z.literal(true).optional(),
  dlqReplayAttempt: z.number().int().min(0).optional(),
});

export type DlqReplayJobFields = z.infer<typeof dlqReplayJobFieldsSchema>;
