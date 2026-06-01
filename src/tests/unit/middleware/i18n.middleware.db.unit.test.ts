import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import { createTestApp } from '@/tests/helpers/test-app.js';
import type { FastifyInstance } from 'fastify';

describe('i18n.middleware (via application stack)', () => {
  let application: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    application = testApp.app;
  });

  afterAll(async () => {
    await application.close();
  });

  it('translates validation errors using default locale', async () => {
    const response = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.detail).toBeTruthy();
  });

  it('accepts Accept-Language header without failing the request', async () => {
    const response = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
      headers: { 'accept-language': 'es-ES,es;q=0.9' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBeDefined();
  });

  it('skips i18n for health live route', async () => {
    const response = await application.inject({ method: 'GET', url: '/livez' });
    expect(response.statusCode).toBe(200);
  });

  it('skips i18n for health ready route', async () => {
    const response = await application.inject({ method: 'GET', url: '/readyz' });
    expect(response.statusCode).toBe(200);
  });

  it('translates validation errors when Accept-Language prefers Spanish', async () => {
    const englishResponse = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    const spanishResponse = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
      headers: { 'accept-language': 'es-ES,es;q=0.9' },
    });
    expect(englishResponse.statusCode).toBe(400);
    expect(spanishResponse.statusCode).toBe(400);
    expect(englishResponse.json().error.detail).toBeTruthy();
    expect(spanishResponse.json().error.detail).toBeTruthy();
  });

  it('returns validation errors for unsupported and supported Accept-Language', async () => {
    const english = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    const spanish = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
      headers: { 'accept-language': 'es-ES,es;q=0.9' },
    });
    const fallback = await application.inject({
      method: 'POST',
      url: testApiPath('/auth/login'),
      payload: {},
      headers: { 'accept-language': 'fr-FR,fr;q=0.9' },
    });
    expect(english.statusCode).toBe(400);
    expect(spanish.statusCode).toBe(400);
    expect(fallback.statusCode).toBe(400);
    expect(english.json().error.detail).toBeTruthy();
    expect(spanish.json().error.detail).toBeTruthy();
    expect(fallback.json().error.detail).toBeTruthy();
    expect(fallback.json().error.detail).toBe(english.json().error.detail);
  });
});
