import { trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureTraceContextForPropagation,
  runWithPropagatedTraceContext,
} from '@/infrastructure/observability/tracing/trace-context.util.js';

describe('BullMQ trace-context propagation (API enqueue → worker processing)', () => {
  let spanExporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    spanExporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    provider.register({ propagator: new W3CTraceContextPropagator() });
  });

  afterEach(async () => {
    await provider.shutdown();
    /** Reset the OTEL global so the next test's `provider.register()` is honoured. */
    trace.disable();
    vi.restoreAllMocks();
  });

  it('injects traceparent into the notification job payload when enqueued within an active span', async () => {
    const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });

    vi.doMock('bullmq', () => ({
      Queue: class MockQueue {
        add = addMock;
        close = vi.fn();
      },
    }));
    vi.doMock('@/infrastructure/queue/connection.js', () => ({
      getBullMQConnectionOptions: () => ({}),
    }));

    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('http.request', async (parentSpan) => {
      const { enqueueNotification } = await import(
        '@/domains/notify/sub-domains/notification/queues/notification.queue.js'
      );
      await enqueueNotification(42, 'org-public-1', 'req-notify-trace');
      parentSpan.end();
    });

    expect(addMock).toHaveBeenCalledOnce();
    const jobPayload = addMock.mock.calls[0]?.[1] as {
      notificationId: number;
      requestId: string;
      traceparent?: string;
    };

    expect(jobPayload.notificationId).toBe(42);
    expect(jobPayload.requestId).toBe('req-notify-trace');
    expect(jobPayload.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[1-9a-f]$/);

    vi.doUnmock('bullmq');
    vi.doUnmock('@/infrastructure/queue/connection.js');
  });

  it('runs the worker job as a child span of the originating request via the injected carrier', async () => {
    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('http.request', async (parentSpan) => {
      const carrier = captureTraceContextForPropagation();

      await runWithPropagatedTraceContext(
        carrier,
        'notification.dispatch-notification',
        async () => {
          const activeSpan = trace.getActiveSpan();
          expect(activeSpan?.spanContext().traceId).toBe(parentSpan.spanContext().traceId);
        },
      );

      parentSpan.end();
    });

    const spans = spanExporter.getFinishedSpans();
    const requestSpan = spans.find((span) => span.name === 'http.request');
    const workerSpan = spans.find((span) => span.name === 'notification.dispatch-notification');

    expect(requestSpan).toBeDefined();
    expect(workerSpan).toBeDefined();
    expect(workerSpan?.parentSpanContext?.spanId).toBe(requestSpan?.spanContext().spanId);
    expect(workerSpan?.spanContext().traceId).toBe(requestSpan?.spanContext().traceId);
  });
});
