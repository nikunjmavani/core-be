import { trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureTraceContextForPropagation,
  runWithPropagatedTraceContext,
} from '@/infrastructure/observability/tracing/trace-context.util.js';

describe('runWithPropagatedTraceContext — error + tracestate branches', () => {
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
    trace.disable();
  });

  it('records the exception and ends the span when the callback throws, then rethrows', async () => {
    const tracer = trace.getTracer('test');
    const boom = new Error('callback failed');

    await tracer.startActiveSpan('http.request', async (parentSpan) => {
      const carrier = captureTraceContextForPropagation();
      await expect(
        runWithPropagatedTraceContext(carrier, 'worker.failing-job', async () => {
          throw boom;
        }),
      ).rejects.toThrow('callback failed');
      parentSpan.end();
    });

    const workerSpan = spanExporter
      .getFinishedSpans()
      .find((span) => span.name === 'worker.failing-job');
    expect(workerSpan).toBeDefined();
    // status code 2 === SpanStatusCode.ERROR; span was ended (it appears in finished spans)
    expect(workerSpan?.status.code).toBe(2);
    expect(workerSpan?.events.some((event) => event.name === 'exception')).toBe(true);
  });

  it('propagates tracestate through the carrier when present', async () => {
    const carrier = {
      traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01',
      tracestate: 'vendor=opaque-value',
    };
    let sawActiveSpan = false;
    let propagatedTraceState: string | undefined;

    await runWithPropagatedTraceContext(carrier, 'worker.with-tracestate', async () => {
      sawActiveSpan = trace.getActiveSpan() !== undefined;
      propagatedTraceState = trace.getActiveSpan()?.spanContext().traceState?.get('vendor');
    });

    expect(sawActiveSpan).toBe(true);
    // The carrier's tracestate must survive extraction, not just the traceparent's trace id.
    expect(propagatedTraceState).toBe('opaque-value');
    const span = spanExporter
      .getFinishedSpans()
      .find((finished) => finished.name === 'worker.with-tracestate');
    expect(span?.spanContext().traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(span?.spanContext().traceState?.get('vendor')).toBe('opaque-value');
  });
});
