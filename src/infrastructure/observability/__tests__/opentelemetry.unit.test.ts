import { trace } from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { InMemorySpanExporter, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OTEL_SERVICE_NAME_API,
  OTEL_SERVICE_NAME_WORKER,
} from '@/shared/constants/project-identity.constants.js';
import {
  captureTraceContextForPropagation,
  runWithPropagatedTraceContext,
} from '@/infrastructure/observability/tracing/trace-context.util.js';

const shutdownMock = vi.fn().mockResolvedValue(undefined);
const startMock = vi.fn();
const otlpExporterConstructorMock = vi.fn();

vi.mock('@opentelemetry/sdk-node', () => ({
  NodeSDK: class MockNodeSDK {
    start = startMock;
    shutdown = shutdownMock;
  },
}));

vi.mock('@opentelemetry/exporter-trace-otlp-http', () => ({
  OTLPTraceExporter: class MockOTLPTraceExporter {
    constructor(options: unknown) {
      otlpExporterConstructorMock(options);
    }
  },
}));

vi.mock('@opentelemetry/instrumentation-http', () => ({
  HttpInstrumentation: class MockHttpInstrumentation {},
}));

const getEnvMock = vi.fn();

vi.mock('@/shared/config/env.config.js', () => ({
  getEnv: () => getEnvMock(),
}));

vi.mock('@/shared/utils/infrastructure/logger.util.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('initOpenTelemetry / shutdownOpenTelemetry', () => {
  beforeEach(async () => {
    vi.resetModules();
    shutdownMock.mockClear();
    startMock.mockClear();
    otlpExporterConstructorMock.mockClear();
    getEnvMock.mockReset();
    const { resetOpenTelemetryStateForTests } = await import(
      '@/infrastructure/observability/tracing/otel.js'
    );
    resetOpenTelemetryStateForTests();
  });

  afterEach(async () => {
    const { resetOpenTelemetryStateForTests } = await import(
      '@/infrastructure/observability/tracing/otel.js'
    );
    resetOpenTelemetryStateForTests();
  });

  it('is a no-op when OTEL_EXPORTER_OTLP_ENDPOINT is unset', async () => {
    getEnvMock.mockReturnValue({
      OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
      OTEL_SERVICE_NAME: undefined,
      SENTRY_ENVIRONMENT: 'test',
      NODE_ENV: 'development',
    });

    const { initOpenTelemetry, shutdownOpenTelemetry } = await import(
      '@/infrastructure/observability/tracing/otel.js'
    );

    initOpenTelemetry(OTEL_SERVICE_NAME_API);
    await shutdownOpenTelemetry();

    expect(startMock).not.toHaveBeenCalled();
    expect(shutdownMock).not.toHaveBeenCalled();
  });

  it('starts NodeSDK with OTLP exporter when endpoint is configured', async () => {
    getEnvMock.mockReturnValue({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com',
      OTEL_SERVICE_NAME: 'core-be-test',
      SENTRY_ENVIRONMENT: 'staging',
      NODE_ENV: 'development',
    });

    const { initOpenTelemetry } = await import('@/infrastructure/observability/tracing/otel.js');
    initOpenTelemetry(OTEL_SERVICE_NAME_API);

    expect(startMock).toHaveBeenCalledOnce();
    expect(otlpExporterConstructorMock).toHaveBeenCalledWith({
      url: 'https://otel.example.com/v1/traces',
    });
  });

  it('shutdownOpenTelemetry flushes via sdk.shutdown()', async () => {
    getEnvMock.mockReturnValue({
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otel.example.com/v1/traces',
      OTEL_SERVICE_NAME: undefined,
      SENTRY_ENVIRONMENT: 'test',
      NODE_ENV: 'development',
    });

    const { initOpenTelemetry, shutdownOpenTelemetry } = await import(
      '@/infrastructure/observability/tracing/otel.js'
    );

    initOpenTelemetry(OTEL_SERVICE_NAME_WORKER);
    await shutdownOpenTelemetry();

    expect(shutdownMock).toHaveBeenCalledOnce();
  });
});

describe('trace context propagation (API → mail enqueue → worker)', () => {
  let spanExporter: InMemorySpanExporter;
  let provider: NodeTracerProvider;

  beforeEach(() => {
    spanExporter = new InMemorySpanExporter();
    provider = new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(spanExporter)],
    });
    provider.register({
      propagator: new W3CTraceContextPropagator(),
    });
  });

  afterEach(async () => {
    await provider.shutdown();
  });

  it('links producer and consumer spans in one trace', async () => {
    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('http.request', async (parentSpan) => {
      const carrier = captureTraceContextForPropagation();
      expect(carrier.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[1-9a-f]$/);

      await runWithPropagatedTraceContext(carrier, 'mail.send-email', async () => {
        const activeSpan = trace.getActiveSpan();
        expect(activeSpan).toBeDefined();
        expect(activeSpan?.spanContext().traceId).toBe(parentSpan.spanContext().traceId);
      });

      parentSpan.end();
    });

    const spans = spanExporter.getFinishedSpans();
    expect(spans).toHaveLength(2);

    const httpSpan = spans.find((span) => span.name === 'http.request');
    const mailSpan = spans.find((span) => span.name === 'mail.send-email');

    expect(httpSpan).toBeDefined();
    expect(mailSpan).toBeDefined();
    expect(mailSpan?.parentSpanContext?.spanId).toBe(httpSpan?.spanContext().spanId);
    expect(mailSpan?.spanContext().traceId).toBe(httpSpan?.spanContext().traceId);
  });

  it('injects traceparent into mail job payload when enqueueing within an active span', async () => {
    const addMock = vi.fn().mockResolvedValue({ id: 'job-1' });

    vi.doMock('bullmq', () => ({
      Queue: class MockQueue {
        add = addMock;
        close = vi.fn();
      },
    }));

    vi.doMock('@/infrastructure/queue/connection.js', () => ({
      getBullMQConnectionOptions: () => ({}),
      getBullMQProducerConnectionOptions: () => ({ enableOfflineQueue: false }),
    }));

    vi.doMock('@/infrastructure/mail/mail-outbox.repository.js', () => ({
      insertMailOutbox: vi.fn(),
    }));

    const tracer = trace.getTracer('test');

    await tracer.startActiveSpan('http.request', async (parentSpan) => {
      const { enqueueMailOutboxJob } = await import('@/infrastructure/mail/queues/mail.queue.js');
      await enqueueMailOutboxJob(99, { requestId: 'req-trace-test' });
      parentSpan.end();
    });

    expect(addMock).toHaveBeenCalledOnce();
    const jobPayload = addMock.mock.calls[0]?.[1] as {
      mailOutboxId: number;
      requestId: string;
      traceparent?: string;
    };
    expect(jobPayload.mailOutboxId).toBe(99);
    expect(jobPayload.requestId).toBe('req-trace-test');
    expect(jobPayload.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-0[1-9a-f]$/);

    vi.doUnmock('bullmq');
    vi.doUnmock('@/infrastructure/queue/connection.js');
    vi.doUnmock('@/infrastructure/mail/mail-outbox.repository.js');
  });

  it('runWithPropagatedTraceContext runs without a span when traceparent is absent', async () => {
    let callbackRan = false;
    await runWithPropagatedTraceContext({}, 'mail.send-email', async () => {
      callbackRan = true;
      expect(trace.getActiveSpan()).toBeUndefined();
    });
    expect(callbackRan).toBe(true);
    expect(spanExporter.getFinishedSpans()).toHaveLength(0);
  });
});
