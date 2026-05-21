import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const LOCALES_ROOT = join(process.cwd(), 'src', 'shared', 'locales');
export const BASE_LOCALE = 'en';
export const OTHER_LOCALES = ['es'] as const;

/** Locale JSON files checked for en ↔ other locale key parity. */
export const LOCALE_PARITY_FILES = [
  'errors.json',
  'success.json',
  'common.json',
  'mail.json',
] as const;

export type LocaleParityFile = (typeof LOCALE_PARITY_FILES)[number];

export function collectLeafKeys(value: unknown, prefix: string, keys: Set<string>): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    if (prefix) keys.add(prefix);
    return;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.entries(record);
  if (entries.length === 0 && prefix) {
    keys.add(prefix);
    return;
  }
  for (const [key, nested] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (nested !== null && typeof nested === 'object' && !Array.isArray(nested)) {
      collectLeafKeys(nested, path, keys);
    } else {
      keys.add(path);
    }
  }
}

export function loadLocaleLeafKeys(locale: string, fileName: LocaleParityFile): Set<string> {
  const path = join(LOCALES_ROOT, locale, fileName);
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  const keys = new Set<string>();
  collectLeafKeys(parsed, '', keys);
  return keys;
}

export type LocaleParityMismatch = {
  fileName: LocaleParityFile;
  locale: string;
  missingInLocale: string[];
  extraInLocale: string[];
};

export function findLocaleParityMismatches(): LocaleParityMismatch[] {
  const mismatches: LocaleParityMismatch[] = [];

  for (const fileName of LOCALE_PARITY_FILES) {
    const baseKeys = loadLocaleLeafKeys(BASE_LOCALE, fileName);

    for (const locale of OTHER_LOCALES) {
      const localeKeys = loadLocaleLeafKeys(locale, fileName);
      const missingInLocale = [...baseKeys].filter((key) => !localeKeys.has(key)).sort();
      const extraInLocale = [...localeKeys].filter((key) => !baseKeys.has(key)).sort();

      if (missingInLocale.length > 0 || extraInLocale.length > 0) {
        mismatches.push({ fileName, locale, missingInLocale, extraInLocale });
      }
    }
  }

  return mismatches;
}
