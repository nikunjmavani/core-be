/**
 * Validates docs/openapi/openapi.json using the Scalar CLI.
 *
 * Prerequisite: Run `pnpm docs:generate` first.
 * Run: pnpm docs:validate:openapi
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const DEFAULT_OPENAPI_SPEC_PATH = join(process.cwd(), 'docs', 'openapi', 'openapi.json');

function resolveOpenApiSpecPath(): string {
  const fromEnvironment = process.env.OPENAPI_SPEC_PATH;
  if (!fromEnvironment) {
    return DEFAULT_OPENAPI_SPEC_PATH;
  }
  return isAbsolute(fromEnvironment) ? fromEnvironment : join(process.cwd(), fromEnvironment);
}

function main(): void {
  const openApiSpecPath = resolveOpenApiSpecPath();

  if (!existsSync(openApiSpecPath)) {
    console.error(`OpenAPI spec not found at ${openApiSpecPath}. Run pnpm docs:generate first.`);
    process.exit(1);
  }

  const result = spawnSync('pnpm', ['exec', 'scalar', 'document', 'validate', openApiSpecPath], {
    stdio: 'inherit',
    cwd: process.cwd(),
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  console.log(`OpenAPI validation passed: ${openApiSpecPath}`);
}

main();
