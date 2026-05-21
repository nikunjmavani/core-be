import { describe, expect, it } from 'vitest';
import {
  getOpenApiLocale,
  loadOpenApiStrings,
} from '../../../../../tooling/openapi/extractors/locale-loader.js';

describe('locale-loader', () => {
  it('getOpenApiLocale defaults to en', () => {
    const previous = process.env.OPENAPI_LOCALE;
    delete process.env.OPENAPI_LOCALE;
    expect(getOpenApiLocale()).toBe('en');
    if (previous !== undefined) process.env.OPENAPI_LOCALE = previous;
  });

  it('loadOpenApiStrings returns English info when locale is en', () => {
    const strings = loadOpenApiStrings('en');
    expect(strings.info?.title).toBeDefined();
    expect(strings.responses?.success).toBeDefined();
  });

  it('loadOpenApiStrings falls back to en for unknown locales', () => {
    const strings = loadOpenApiStrings('zz-unknown-locale');
    expect(strings.info?.title).toBe(loadOpenApiStrings('en').info?.title);
  });
});
