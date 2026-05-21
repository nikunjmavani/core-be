/**
 * Ensures errors.json keys match across all configured locales (en, es).
 * Usage: pnpm validate:locale-errors-parity
 * @deprecated Prefer pnpm validate:locale-keys (includes success/common/mail + code audit).
 */
import {
  BASE_LOCALE,
  findLocaleParityMismatches,
  OTHER_LOCALES,
} from './locale-key-parity.util.js';

function main(): void {
  const mismatches = findLocaleParityMismatches().filter((m) => m.fileName === 'errors.json');

  if (mismatches.length > 0) {
    for (const { locale, missingInLocale, extraInLocale } of mismatches) {
      console.error(`\n❌ errors.json key mismatch: ${BASE_LOCALE} vs ${locale}`);
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

  console.log(
    `✅ validate-locale-errors-parity passed (${BASE_LOCALE} ↔ ${OTHER_LOCALES.join(', ')})`,
  );
}

main();
