import type { FastifyInstance } from 'fastify';
import type { InjectOptions } from 'light-my-request';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { loadSmokeEnvironment } from '@/tests/smoke/helpers/smoke-env.js';

export type SmokeFetchOptions = {
  method?: InjectOptions['method'];
  headers?: Record<string, string>;
  body?: unknown;
  expectStatus?: number | number[];
};

let smokeApplication: FastifyInstance | undefined;

async function getSmokeApplication(): Promise<FastifyInstance> {
  if (!smokeApplication) {
    smokeApplication = (await createTestApp()).app;
  }
  return smokeApplication;
}

function assertExpectedStatus(
  method: string,
  path: string,
  statusCode: number,
  bodyText: string,
  expectStatus: number | number[] | undefined,
): void {
  if (expectStatus === undefined) {
    return;
  }
  const allowed = Array.isArray(expectStatus) ? expectStatus : [expectStatus];
  if (!allowed.includes(statusCode)) {
    throw new Error(
      `Smoke ${method} ${path} expected ${allowed.join('|')} got ${statusCode}: ${bodyText.slice(0, 200)}`,
    );
  }
}

export async function smokeFetch(path: string, options: SmokeFetchOptions = {}): Promise<Response> {
  const method: InjectOptions['method'] = options.method ?? 'GET';
  const useExternal =
    process.env.SMOKE_EXTERNAL === 'true' || process.env.SMOKE_USE_EXTERNAL === 'true';

  if (useExternal) {
    const { baseUrl } = loadSmokeEnvironment();
    const url = `${baseUrl.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;
    const fetchInit: RequestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        ...options.headers,
      },
    };
    if (options.body !== undefined) {
      fetchInit.body = JSON.stringify(options.body);
    }
    const response = await fetch(url, fetchInit);
    if (options.expectStatus !== undefined) {
      const allowed = Array.isArray(options.expectStatus)
        ? options.expectStatus
        : [options.expectStatus];
      if (!allowed.includes(response.status)) {
        const text = await response.text();
        throw new Error(
          `Smoke ${method} ${path} expected ${allowed.join('|')} got ${response.status}: ${text.slice(0, 200)}`,
        );
      }
    }
    return response;
  }

  const application = await getSmokeApplication();
  const injectOptions: InjectOptions = {
    method,
    url: path,
  };
  if (options.headers !== undefined) {
    injectOptions.headers = options.headers;
  }
  if (options.body !== undefined) {
    injectOptions.payload = options.body as NonNullable<InjectOptions['payload']>;
  }
  const injectResult = await application.inject(injectOptions);
  assertExpectedStatus(
    method,
    path,
    injectResult.statusCode,
    injectResult.body,
    options.expectStatus,
  );

  return new Response(injectResult.body, {
    status: injectResult.statusCode,
    headers: Object.fromEntries(
      Object.entries(injectResult.headers).map(([key, value]) => [
        key,
        Array.isArray(value) ? value.join(',') : String(value ?? ''),
      ]),
    ),
  });
}

export async function smokeLogin(): Promise<{ accessToken: string }> {
  const { demoEmail, demoPassword } = loadSmokeEnvironment();
  const { database } = await import('@/infrastructure/database/connection.js');
  const { users } = await import('@/domains/user/user.schema.js');
  const { eq } = await import('drizzle-orm');
  const { hashPassword } = await import('@/shared/utils/security/password.util.js');

  const [existingUser] = await database
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(eq(users.email, demoEmail))
    .limit(1);

  const password = demoPassword;
  const passwordHash = await hashPassword(demoPassword);
  let email = demoEmail;
  if (!existingUser) {
    const { createTestUserWithPassword } = await import('@/tests/factories/user.factory.js');
    const created = await createTestUserWithPassword({ email: demoEmail, password: demoPassword });
    email = created.user.email;
  } else {
    await database
      .update(users)
      .set({ password_hash: passwordHash, deleted_at: null, status: 'ACTIVE' })
      .where(eq(users.id, existingUser.id));
    email = existingUser.email;
  }
  const response = await smokeFetch('/api/v1/auth/login', {
    method: 'POST',
    body: { email, password },
    expectStatus: 200,
  });
  const json = (await response.json()) as { data?: { access_token?: string } };
  const accessToken = json.data?.access_token;
  if (!accessToken) {
    throw new Error('Smoke login did not return access_token');
  }
  return { accessToken };
}

export async function closeSmokeApplication(): Promise<void> {
  if (smokeApplication) {
    await smokeApplication.close();
    smokeApplication = undefined;
  }
}
