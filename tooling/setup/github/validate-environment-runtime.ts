/**
 * Pre-deploy runtime validation of a GitHub Environment against the env schema.
 *
 * Run inside a deploy job AFTER the GitHub Environment's secrets + variables
 * have been exported into `process.env` (the "Export GitHub Environment to
 * runner" step in `.github/workflows/reusable-railway-deploy.yml`). Asserts
 * every schema-required key is present and non-empty BEFORE any container is
 * deployed — a pre-flight echo of the hard Zod validation the app performs at
 * boot (`src/shared/config/env-schema.ts`), so a missing secret fails the
 * workflow instead of crash-looping the deployed service.
 *
 *   CONFIG=<environment> pnpm validate:github-env-runtime
 *
 * Environment variables:
 *   CONFIG   Target environment name (development / production) — messaging only.
 *
 * Exit codes:
 *   0   All required keys present and non-empty (conditional keys may warn).
 *   1   One or more required keys missing or empty.
 */
import { fileURLToPath } from 'node:url';
import {
  envSchemaConditionallyRequiredKeys,
  envSchemaRequiredKeys,
} from '@/shared/config/env-schema.js';

/**
 * Returns the subset of `keys` that are absent, empty, or whitespace-only in `environmentValues`.
 *
 * @remarks
 * Whitespace-only counts as missing on purpose: an empty GitHub Environment secret arrives at the
 * runner as `''`, which would satisfy a plain `key in process.env` check yet still fail the app's
 * Zod validation at boot — exactly the crash-loop this pre-flight exists to prevent.
 */
export function findMissingKeys(
  environmentValues: NodeJS.ProcessEnv,
  keys: readonly string[],
): string[] {
  return keys.filter((key) => {
    const value = environmentValues[key];
    return value === undefined || value.trim() === '';
  });
}

/** Resolves the environment label used in log output (messaging only — never gates behaviour). */
export function resolveEnvironmentLabel(environmentValues: NodeJS.ProcessEnv): string {
  return environmentValues.CONFIG ?? environmentValues.ENVIRONMENT ?? 'unknown';
}

/**
 * Validates `process.env` against the schema's required keys and reports the result.
 *
 * @remarks
 * Side effects: writes to stdout/stderr and returns the intended process exit code (0 pass, 1 fail).
 * Conditionally-required keys only emit a `::warning` — they depend on flag values this pre-flight
 * cannot inspect, so they never fail the deploy.
 */
export function runEnvironmentValidation(environmentValues: NodeJS.ProcessEnv): number {
  const environment = resolveEnvironmentLabel(environmentValues);
  const missing = findMissingKeys(environmentValues, envSchemaRequiredKeys);
  const conditionalMissing = findMissingKeys(
    environmentValues,
    envSchemaConditionallyRequiredKeys.map(({ key }) => key),
  );

  for (const { key, condition } of envSchemaConditionallyRequiredKeys) {
    if (!conditionalMissing.includes(key)) continue;
    console.log(
      `::warning title=Conditionally required key absent in ${environment}::${key} is unset — required when ${condition}.`,
    );
  }

  if (missing.length > 0) {
    console.error(
      `Missing or empty required env keys in GitHub Environment "${environment}" (${missing.length}/${envSchemaRequiredKeys.length}):`,
    );
    for (const key of missing) {
      console.error(`  - ${key}`);
    }
    console.error(
      'Add the key to the GitHub Environment (gh secret set / gh api .../variables, or `pnpm github:sync <environment>`) and re-run the deploy.',
    );
    return 1;
  }

  console.log(
    `GitHub Environment "${environment}": all ${envSchemaRequiredKeys.length} schema-required keys present.`,
  );
  return 0;
}

// Run as CLI only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  process.exit(runEnvironmentValidation(process.env));
}
