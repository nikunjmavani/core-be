import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Absolute path to the locales root (`src/shared/locales/`) used by parity checks. */
export const LOCALES_ROOT = join(process.cwd(), 'src', 'shared', 'locales');

/** Locale code that all other locales must remain key-equivalent to. */
export const BASE_LOCALE = 'en';

/** Non-base locales scanned for parity against {@link BASE_LOCALE}. */
export const OTHER_LOCALES = ['es'] as const;

/** Locale JSON files checked for en ↔ other locale key parity. */
export const LOCALE_PARITY_FILES = [
  'errors.json',
  'success.json',
  'common.json',
  'mail.json',
] as const;

/** String-literal union of locale JSON files covered by parity checks. */
export type LocaleParityFile = (typeof LOCALE_PARITY_FILES)[number];

/**
 * Recursively flattens a parsed JSON value into dot-separated leaf paths and
 * appends them to `keys`. Non-object values (and empty objects) become a leaf
 * at the caller-supplied `prefix`.
 */
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

/** Reads and flattens a single locale JSON file into the set of dotted leaf keys it declares. */
export function loadLocaleLeafKeys(locale: string, fileName: LocaleParityFile): Set<string> {
  const path = join(LOCALES_ROOT, locale, fileName);
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as unknown;
  const keys = new Set<string>();
  collectLeafKeys(parsed, '', keys);
  return keys;
}

/** One file × locale pair where the key set diverges from {@link BASE_LOCALE}. */
export type LocaleParityMismatch = {
  fileName: LocaleParityFile;
  locale: string;
  missingInLocale: string[];
  extraInLocale: string[];
};

/**
 * Loads every {@link LOCALE_PARITY_FILES} for the base locale and each entry
 * in {@link OTHER_LOCALES} and returns mismatches (keys present in `en` but
 * missing elsewhere, or extras only in the non-base locale). Used by
 * `pnpm tool:check-locale-parity` to fail CI on i18n drift.
 */
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
