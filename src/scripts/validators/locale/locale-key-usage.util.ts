/**
 * Locale key-usage gate: every `<namespace>:<key>` referenced in runtime source must resolve to a
 * key defined in the base-locale JSON. Complements the parity check (en ↔ es) — parity cannot catch
 * a key that is missing from BOTH locales, which renders to users as the raw `errors:foo` string.
 * Part of `pnpm validate:locale-keys`.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  BASE_LOCALE,
  collectLeafKeys,
  LOCALE_PARITY_FILES,
  LOCALES_ROOT,
} from './locale-key-parity.util.js';

const SRC_ROOT = join(process.cwd(), 'src');

/**
 * Runtime code only. Tests deliberately reference fixture/probe keys, and tooling/codegen scripts
 * embed example keys in generated docs — neither leaks to users, so both are excluded.
 */
const EXCLUDED_PATH_PATTERNS = [/\/__tests__\//, /\/tests\//, /\/scripts\//, /\.test\.ts$/];

/**
 * Matches an i18n key reference `<namespace>:<dotted.key>`. The leading boundary rejects
 * identifier-embedded false positives such as `email:queued` (whose `mail:queued` tail would
 * otherwise match) — a genuine reference is always preceded by a quote, backtick, or other
 * non-identifier character.
 */
const KEY_REFERENCE_PATTERN = /(?<![A-Za-z0-9_])(errors|success|common|mail):[A-Za-z0-9_.]+/g;

/** One runtime `<namespace>:<key>` reference that has no matching key in the base locale. */
export type UndefinedKeyReference = { file: string; line: number; key: string };

function isExcluded(filePath: string): boolean {
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function collectTypeScriptFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(absolutePath, collected);
    } else if (entry.name.endsWith('.ts')) {
      collected.push(absolutePath);
    }
  }
  return collected;
}

/** Flattens every base-locale namespace JSON into the set of `<namespace>:<dotted.key>` it declares. */
export function loadDefinedKeys(): Set<string> {
  const defined = new Set<string>();
  for (const fileName of LOCALE_PARITY_FILES) {
    const namespace = fileName.replace(/\.json$/, '');
    const leafKeys = new Set<string>();
    collectLeafKeys(
      JSON.parse(readFileSync(join(LOCALES_ROOT, BASE_LOCALE, fileName), 'utf-8')) as unknown,
      '',
      leafKeys,
    );
    for (const leafKey of leafKeys) defined.add(`${namespace}:${leafKey}`);
  }
  return defined;
}

/**
 * Scans runtime `src/**` TypeScript (excluding tests and tooling scripts) for `<namespace>:<key>`
 * references and returns each one absent from the base-locale JSON — the defect that leaks a raw
 * translation key to users.
 */
export function findUndefinedKeyReferences(): UndefinedKeyReference[] {
  const defined = loadDefinedKeys();
  const violations: UndefinedKeyReference[] = [];

  for (const absolutePath of collectTypeScriptFiles(SRC_ROOT)) {
    const relativePath = relative(process.cwd(), absolutePath);
    if (isExcluded(relativePath)) continue;

    const lines = readFileSync(absolutePath, 'utf-8').split('\n');
    lines.forEach((text, index) => {
      for (const match of text.matchAll(KEY_REFERENCE_PATTERN)) {
        const key = match[0];
        if (!defined.has(key)) {
          violations.push({ file: relativePath, line: index + 1, key });
        }
      }
    });
  }

  return violations;
}
