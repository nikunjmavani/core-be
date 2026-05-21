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

  if (failed) {
    console.error(
      '\nFix: sync src/shared/locales/es/*.json with en; use messageKey-only throws (see docs/reference/runtime/internationalization.md).',
    );
    process.exit(1);
  }

  console.log(
    `✅ validate-locale-keys passed (${BASE_LOCALE} ↔ ${OTHER_LOCALES.join(', ')}; ${LOCALE_PARITY_FILES.join(', ')}; no redundant fallbacks)`,
  );
}

main();
