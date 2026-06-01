import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import { join } from 'node:path';
import { createTestApp } from '@/tests/helpers/test-app.js';
import { injectRoute } from '@/tests/helpers/test-http-inject.helper.js';

const LOCALES_DIR = join(process.cwd(), 'src', 'shared', 'locales');
const LOCALES_LOAD_PATH = join(LOCALES_DIR, '{{lng}}', '{{ns}}.json');

describe('Integration: i18n locale fallback', () => {
  let app: Awaited<ReturnType<typeof createTestApp>>['app'];

  beforeAll(async () => {
    await i18next.use(Backend).init({
      preload: ['en', 'es'],
      ns: ['errors'],
      defaultNS: 'errors',
      fallbackLng: 'en',
      returnNull: false,
      backend: { loadPath: LOCALES_LOAD_PATH },
    });

    const testApplication = await createTestApp();
    app = testApplication.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('falls back to English when a key is missing in the requested locale', () => {
    i18next.addResource('en', 'errors', 'integrationFallbackProbe', 'English-only probe message');

    const translated = i18next.t('errors:integrationFallbackProbe', { lng: 'es' });

    expect(translated).toBe('English-only probe message');
    expect(translated).not.toBe('errors:integrationFallbackProbe');
    expect(translated).not.toBeNull();
  });

  it('returns the key string instead of null when translation is completely missing', () => {
    const missingKey = 'errors:integrationMissingKeyProbe';
    const translated = i18next.t(missingKey, { lng: 'es' });

    expect(translated).not.toBeNull();
    expect(typeof translated).toBe('string');
    expect(translated.length).toBeGreaterThan(0);
  });

  it('returns translated 404 detail via HTTP Accept-Language when locale is supported', async () => {
    const response = await injectRoute(app, {
      method: 'GET',
      url: testApiPath('/auth/nonexistent-route-for-i18n-fallback-test'),
      headers: { 'accept-language': 'es' },
    });

    expect(response.statusCode).toBe(404);
    const errorDetail = (response.json() as { error?: { detail?: string } }).error?.detail;
    expect(typeof errorDetail).toBe('string');
    expect(['Route not found', 'Ruta no encontrada']).toContain(errorDetail);
  });

  it('returns English 404 detail when Accept-Language is unsupported (fr)', async () => {
    const englishResponse = await injectRoute(app, {
      method: 'GET',
      url: testApiPath('/auth/nonexistent-route-for-i18n-fallback-test'),
      headers: { 'accept-language': 'en-US,en;q=0.9' },
    });
    const frenchResponse = await injectRoute(app, {
      method: 'GET',
      url: testApiPath('/auth/nonexistent-route-for-i18n-fallback-test'),
      headers: { 'accept-language': 'fr-FR,fr;q=0.9' },
    });

    expect(englishResponse.statusCode).toBe(404);
    expect(frenchResponse.statusCode).toBe(404);
    const englishDetail = (englishResponse.json() as { error?: { detail?: string } }).error?.detail;
    const frenchDetail = (frenchResponse.json() as { error?: { detail?: string } }).error?.detail;
    expect(englishDetail).toBe('Route not found');
    expect(frenchDetail).toBe('Route not found');
    expect(frenchDetail).toBe(englishDetail);
  });

  it('returns English 404 detail over HTTP when the Spanish translation is missing', async () => {
    i18next.addResource('es', 'errors', 'routeNotFound', '');
    try {
      const response = await injectRoute(app, {
        method: 'GET',
        url: testApiPath('/auth/nonexistent-route-for-i18n-fallback-test'),
        headers: { 'accept-language': 'es-ES,es;q=0.9' },
      });

      expect(response.statusCode).toBe(404);
      const errorDetail = (response.json() as { error?: { detail?: string } }).error?.detail;
      expect(errorDetail).toBe('Route not found');
      expect(errorDetail).not.toBe('errors:routeNotFound');
      expect(errorDetail).not.toBe('Ruta no encontrada');
    } finally {
      i18next.addResource('es', 'errors', 'routeNotFound', 'Ruta no encontrada');
    }
  });
});
