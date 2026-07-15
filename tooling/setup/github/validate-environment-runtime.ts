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
import {
  envSchemaConditionallyRequiredKeys,
  envSchemaRequiredKeys,
} from '@/shared/config/env-schema.js';

const environment = process.env.CONFIG ?? process.env.ENVIRONMENT ?? 'unknown';

const missing = envSchemaRequiredKeys.filter((key) => {
  const value = process.env[key];
  return value === undefined || value.trim() === '';
});

const conditionalMissing = envSchemaConditionallyRequiredKeys.filter(({ key }) => {
  const value = process.env[key];
  return value === undefined || value.trim() === '';
});

for (const { key, condition } of conditionalMissing) {
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
  process.exit(1);
}

console.log(
  `GitHub Environment "${environment}": all ${envSchemaRequiredKeys.length} schema-required keys present.`,
);
