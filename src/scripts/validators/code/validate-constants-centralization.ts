/**
 * Flags numeric literals reused across multiple files outside `src/shared/constants/`.
 *
 * Usage: pnpm validate:constants
 */
import { findDuplicateLiteralViolations } from './constants-centralization.util.js';

function main(): void {
  const violations = findDuplicateLiteralViolations();

  if (violations.length === 0) {
    console.log('✅ validate-constants-centralization passed');
    return;
  }

  console.error('Duplicate numeric literals across files (centralize in src/shared/constants/):\n');

  for (const violation of violations) {
    console.error(`  value ${violation.value}:`);
    for (const occurrence of violation.occurrences) {
      console.error(`    - ${occurrence.file}:${occurrence.line}  ${occurrence.snippet}`);
    }
    console.error('');
  }

  console.error(
    'Rule: any constant referenced from more than one file belongs in src/shared/constants/<topic>.constants.ts',
  );
  process.exit(1);
}

main();
