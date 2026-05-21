import { describe, expect, it, vi } from 'vitest';
import type * as nodeFs from 'node:fs';
import { existsSync } from 'node:fs';
import type { FastifyRequest } from 'fastify';
import {
  attachRequestI18nHelpers,
  resolveRequestLanguageFromHeader,
  verifyLocalesAvailable,
} from '@/shared/middlewares/i18n.middleware.js';

vi.mock('i18next', () => ({
  default: {
    t: (key: string) => `i18n:${key}`,
  },
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof nodeFs>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
  };
});

describe('i18n.middleware helpers', () => {
  it('resolveRequestLanguageFromHeader maps Spanish and defaults', () => {
    expect(resolveRequestLanguageFromHeader(undefined)).toBe('en');
    expect(resolveRequestLanguageFromHeader(undefined, 'es')).toBe('es');
    expect(resolveRequestLanguageFromHeader(',es-ES')).toBe('en');
    expect(resolveRequestLanguageFromHeader('es-ES,es;q=0.9')).toBe('es');
    expect(resolveRequestLanguageFromHeader('en-US,en;q=0.9')).toBe('en');
    expect(resolveRequestLanguageFromHeader('fr-FR,fr;q=0.9')).toBe('en');
    expect(resolveRequestLanguageFromHeader(['es-ES', 'en'])).toBe('es');
    expect(resolveRequestLanguageFromHeader('fr')).toBe('en');
    expect(resolveRequestLanguageFromHeader('de-DE,de;q=0.9')).toBe('en');
  });

  it('verifyLocalesAvailable throws when locales directory is missing', () => {
    vi.mocked(existsSync).mockReturnValue(false);
    expect(() => verifyLocalesAvailable()).toThrow(/Locales directory not found/);
  });

  it('attachRequestI18nHelpers copies language and uses req.t when provided', () => {
    const request = { headers: { 'accept-language': 'es-ES' } } as FastifyRequest;
    const req: { language?: string; t: (key: string) => string } = {
      t: (key: string) => `custom:${key}`,
    };
    attachRequestI18nHelpers(request, req);
    expect(req.language).toBe('es');
    expect((request as { language?: string }).language).toBe('es');
    expect((request as { t?: (key: string) => string }).t?.('errors:invalidInput')).toBe(
      'custom:errors:invalidInput',
    );
  });

  it('attachRequestI18nHelpers falls back to i18next.t when req.t is absent', () => {
    const request = { headers: {} } as FastifyRequest;
    const req: { language?: string } = {};
    attachRequestI18nHelpers(request, req);
    expect(req.language).toBe('en');
    expect((request as { t?: (key: string) => string }).t?.('errors:invalidInput')).toBe(
      'i18n:errors:invalidInput',
    );
  });

  it('attachRequestI18nHelpers uses English when request language is cleared before translate', () => {
    const request = { headers: {} } as FastifyRequest;
    const req: { language?: string } = {};
    attachRequestI18nHelpers(request, req);
    delete (request as { language?: string }).language;
    expect((request as { t?: (key: string) => string }).t?.('errors:invalidInput')).toBe(
      'i18n:errors:invalidInput',
    );
  });

  it('verifyLocalesAvailable throws when a required namespace file is missing', () => {
    vi.mocked(existsSync).mockImplementation((path) => !String(path).endsWith('en/errors.json'));
    expect(() => verifyLocalesAvailable()).toThrow(/Required locale file not found/);
  });
});
