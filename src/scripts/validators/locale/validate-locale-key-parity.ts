/**
 * Ensures errors, success, common, and mail locale keys match across en and es.
 * Usage: pnpm validate:locale-keys (via validate-locale-keys.ts orchestrator)
 */
import {
  BASE_LOCALE,
  findLocaleParityMismatches,
  LOCALE_PARITY_FILES,
  OTHER_LOCALES,
} from './locale-key-parity.util.js';

function main(): void {
  const mismatches = findLocaleParityMismatches();

  if (mismatches.length === 0) {
    console.log(
      `✅ validate-locale-key-parity passed (${BASE_LOCALE} ↔ ${OTHER_LOCALES.join(', ')}; ${LOCALE_PARITY_FILES.join(', ')})`,
    );
    return;
  }

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

  process.exit(1);
}

main();
