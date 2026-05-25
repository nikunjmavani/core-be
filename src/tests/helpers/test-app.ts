import { buildApp, type RegisteredRouteCapture } from '@/app.js';
import { connectBullMqRedis } from '@/infrastructure/cache/bullmq-redis.client.js';
import { connectRedis } from '@/infrastructure/cache/redis.client.js';
import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';

type TestHttpMethod = NonNullable<InjectOptions['method']>;

export type TestRequestResponse = {
  status: number;
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
  text: string;
};

type TestRequestMethod = (url: string) => TestRequestBuilder;

export type TestRequestAgent = {
  get: TestRequestMethod;
  post: TestRequestMethod;
  put: TestRequestMethod;
  patch: TestRequestMethod;
  delete: TestRequestMethod;
  options: TestRequestMethod;
};

export type TestAppResult = {
  app: FastifyInstance;
  request: TestRequestAgent;
  registeredRoutes: RegisteredRouteCapture[];
};

class TestRequestBuilder implements PromiseLike<TestRequestResponse> {
  private readonly headers: Record<string, string> = {};
  private payload: unknown;
  private queryParameters: Record<string, string> | undefined;

  constructor(
    private readonly app: FastifyInstance,
    private readonly method: TestHttpMethod,
    private readonly url: string,
  ) {}

  set(name: string, value: string): this;
  set(headers: Record<string, string>): this;
  set(nameOrHeaders: string | Record<string, string>, value?: string): this {
    if (typeof nameOrHeaders === 'string') {
      if (value !== undefined) {
        this.headers[nameOrHeaders] = value;
      }
      return this;
    }

    Object.assign(this.headers, nameOrHeaders);
    return this;
  }

  send(payload: unknown): this {
    this.payload = payload;
    return this;
  }

  query(queryParameters: Record<string, string>): this {
    this.queryParameters = queryParameters;
    return this;
  }

  then<TResult1 = TestRequestResponse, TResult2 = never>(
    onfulfilled?: ((value: TestRequestResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  catch<TResult = never>(
    onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null,
  ): Promise<TestRequestResponse | TResult> {
    return this.execute().catch(onrejected);
  }

  private async execute(): Promise<TestRequestResponse> {
    const options: InjectOptions = {
      method: this.method,
      url: this.url,
      headers: this.headers,
    };
    if (this.payload !== undefined) {
      options.payload = this.payload as NonNullable<InjectOptions['payload']>;
    }
    if (this.queryParameters !== undefined) {
      options.query = this.queryParameters;
    }

    const response = await this.app.inject(options);
    let body: unknown;
    if (response.body) {
      try {
        body = JSON.parse(response.body) as unknown;
      } catch {
        body = response.body;
      }
    }
    return {
      status: response.statusCode,
      statusCode: response.statusCode,
      headers: response.headers as Record<string, string | string[] | undefined>,
      body,
      text: response.body,
    };
  }
}

function createTestRequestAgent(app: FastifyInstance): TestRequestAgent {
  const createMethod =
    (method: TestHttpMethod): TestRequestMethod =>
    (url) =>
      new TestRequestBuilder(app, method, url);

  return {
    get: createMethod('GET'),
    post: createMethod('POST'),
    put: createMethod('PUT'),
    patch: createMethod('PATCH'),
    delete: createMethod('DELETE'),
    options: createMethod('OPTIONS'),
  };
}

/**
 * Build a test Fastify instance with all middleware and routes registered.
 * Returns the app and captured route list for parity tests.
 * Use `app.inject()` or helpers from `test-http-inject.helper.ts` for HTTP calls.
 * Always call `app.close()` after tests.
 *
 * Both Redis connections are eagerly connected before serving traffic so
 * `/health` (which pings cache + BullMQ Redis when they live on different
 * logical databases) does not hit "Stream isn't writeable" with
 * `enableOfflineQueue: false`.
 */
export async function createTestApp(): Promise<TestAppResult> {
  await Promise.all([connectRedis(), connectBullMqRedis()]);
  const registeredRoutes: RegisteredRouteCapture[] = [];
  const app = await buildApp({ captureRegisteredRoutes: registeredRoutes });
  await app.ready();
  return { app, request: createTestRequestAgent(app), registeredRoutes };
}
