/**
 * CI gate: enforces the public API v1 sunset date against the 90-day deprecation policy.
 *
 * Fails if `PUBLIC_API_V1_SUNSET` is already in the past or falls inside the minimum
 * notice window. No-op (exit 0) while the sunset date is null.
 *
 * Usage: pnpm validate:sunset-dates
 */
import { PUBLIC_API_V1_SUNSET } from '@/shared/utils/http/api-versioning.util.js';

const MINIMUM_SUNSET_NOTICE_DAYS = 90;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

function main(): void {
  if (PUBLIC_API_V1_SUNSET === null) {
    console.log('No /api/v1 sunset announced (PUBLIC_API_V1_SUNSET is null). Nothing to validate.');
    return;
  }

  const now = new Date();
  const sunsetIso = PUBLIC_API_V1_SUNSET.toISOString();
  const millisecondsRemaining = PUBLIC_API_V1_SUNSET.getTime() - now.getTime();

  if (millisecondsRemaining <= 0) {
    console.error(
      `PUBLIC_API_V1_SUNSET (${sunsetIso}) is in the past. The announced sunset has already been exceeded.`,
    );
    process.exit(1);
  }

  const daysRemaining = millisecondsRemaining / MILLISECONDS_PER_DAY;
  if (daysRemaining < MINIMUM_SUNSET_NOTICE_DAYS) {
    console.error(
      `PUBLIC_API_V1_SUNSET (${sunsetIso}) is only ${Math.floor(daysRemaining)} day(s) away, ` +
        `which violates the ${MINIMUM_SUNSET_NOTICE_DAYS}-day deprecation notice policy.`,
    );
    process.exit(1);
  }

  console.log(
    `PUBLIC_API_V1_SUNSET is set to ${sunsetIso} (${Math.floor(daysRemaining)} day(s) remaining), ` +
      `which satisfies the ${MINIMUM_SUNSET_NOTICE_DAYS}-day deprecation notice policy.`,
  );
}

main();
