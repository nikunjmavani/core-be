import { z } from 'zod';

/**
 * W3C trace context carried on BullMQ job payloads so a worker span can be linked as a child of
 * the originating API request. Injected on enqueue via `captureTraceContextForPropagation` and
 * consumed by `runWithPropagatedTraceContext` in the worker. Both fields are optional — jobs
 * enqueued outside an active span (or with OTEL disabled) simply omit them.
 */
export const traceContextJobFieldsSchema = z.object({
  traceparent: z.string().min(1).max(256).optional(),
  tracestate: z.string().min(1).max(512).optional(),
});

/** Type inferred from {@link traceContextJobFieldsSchema}; mixed into per-queue job DTOs. */
export type TraceContextJobFields = z.infer<typeof traceContextJobFieldsSchema>;
