/**
 * Locale i18n gates: JSON key parity (en ↔ es) and no redundant English error fallbacks in src/.
 * Usage: pnpm validate:locale-keys
 */
import { findHardcodedFallbackViolations } from './validate-locale-hardcoded-fallbacks.js';
import {
  BASE_LOCALE,
  findLocaleParityMismatches,
  LOCALE_PARITY_FILES,
  OTHER_LOCALES,
} from './locale-key-parity.util.js';
import { findUndefinedKeyReferences } from './locale-key-usage.util.js';

function main(): void {
  let failed = false;

  const mismatches = findLocaleParityMismatches();
  if (mismatches.length > 0) {
    failed = true;
    for (const { fileName, locale, missingInLocale, extraInLocale } of mismatches) {
      console.error(`\n❌ ${fileName} key mismatch: ${BASE_LOCALE} vs ${locale}`);
      if (missingInLocale.length > 0) {
        console.error(`  Missing in ${locale} (${missingInLocale.length}):`);
        for (const key of missingInLocale) console.error(`    - ${key}`);
      }
      if (extraInLocale.length > 0) {
        console.error(`  Extra in ${locale} (${extraInLocale.length}):`);
        for (const key of extraInLocale) console.error(`    + ${key}`);
      }
    }
  }

  const fallbackViolations = findHardcodedFallbackViolations();
  if (fallbackViolations.length > 0) {
    failed = true;
    console.error('\n❌ Hardcoded user-facing error fallbacks:\n');
    for (const violation of fallbackViolations) {
      console.error(
        `  ${violation.file}:${violation.line} [${violation.kind}] ${violation.detail}`,
      );
    }
  }

  const undefinedKeyReferences = findUndefinedKeyReferences();
  if (undefinedKeyReferences.length > 0) {
    failed = true;
    console.error('\n❌ i18n keys referenced in code but missing from the locale JSON:\n');
    for (const { file, line, key } of undefinedKeyReferences) {
      console.error(`  ${file}:${line} -> ${key}`);
    }
  }

  if (failed) {
    console.error(
      '\nFix: add the key to src/shared/locales/en/*.json (then es), sync es with en, and use messageKey-only throws (see docs/reference/runtime/internationalization.md).',
    );
    process.exit(1);
  }

  console.log(
    `✅ validate-locale-keys passed (${BASE_LOCALE} ↔ ${OTHER_LOCALES.join(', ')}; ${LOCALE_PARITY_FILES.join(', ')}; no redundant fallbacks; every referenced key defined)`,
  );
}

main();
