import type { z } from 'zod';

/**
 * Validates BullMQ job payloads at enqueue and worker boundaries.
 */
export function parseBullMQJobData<T>(schema: z.ZodType<T>, data: unknown, queueName: string): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const details = parsed.error.flatten();
    throw new Error(
      `bullmq.invalid_job_payload:${queueName}:${JSON.stringify(details.fieldErrors)}`,
    );
  }
  return parsed.data;
}
