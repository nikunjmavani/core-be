/**
 * Bans hardcoded `/api/vN/` in inject `url` fields — use `testApiPath()` from
 * `@/tests/helpers/test-api-prefix.helper.js` instead.
 *
 * `describe` / `it` titles, route registration, OpenAPI fixtures, and smoke `fetch`
 * paths may still use literal `/api/v1/...`.
 *
 * Usage: pnpm validate:test-api-prefix
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Hardcoded version segment in an inject/options `url` property. */
export const INJECT_URL_PATTERN = /url:\s*['`]\/api\/v\d+/;

/**
 * Files that intentionally embed a literal `/api/vN` in a `url:` property that is
 * NOT a real `inject()` call, so the `testApiPath()` ban does not apply:
 * - validator fixtures — literal inject-URL strings fed to the route-coverage analyzer;
 * - unit tests that build mocked `FastifyRequest` objects whose `url` is the request path.
 */
export const EXCLUDED_RELATIVE_PATHS = new Set([
  'src/tests/unit/scripts/route-http-coverage-validation.unit.test.ts',
  'src/tests/unit/utils/auth/authorization.util.permission-deny-audit.unit.test.ts',
]);

/** A single test file × line that hardcodes a `/api/vN/` prefix in an inject URL. */
export type InjectUrlViolation = { file: string; line: number };

/**
 * Walks every `*.test.ts` file under `sourceRoot/src/` and returns lines whose
 * `url:` property uses a hardcoded `/api/vN/` prefix instead of the
 * `testApiPath()` helper. Files in {@link EXCLUDED_RELATIVE_PATHS} are
 * skipped because they intentionally embed literal inject URLs.
 */
export function findInjectUrlViolations(
  sourceRoot: string,
  projectRoot: string = process.cwd(),
): InjectUrlViolation[] {
  const violations: InjectUrlViolation[] = [];
  const srcDirectory = join(sourceRoot, 'src');

  function walk(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.test.ts')) continue;

      const relativePath = relative(projectRoot, fullPath);
      if (EXCLUDED_RELATIVE_PATHS.has(relativePath)) continue;

      const lines = readFileSync(fullPath, 'utf-8').split('\n');
      for (let index = 0; index < lines.length; index++) {
        if (INJECT_URL_PATTERN.test(lines[index] ?? '')) {
          violations.push({ file: relativePath, line: index + 1 });
        }
      }
    }
  }

  walk(srcDirectory);
  return violations;
}

function main(): void {
  const violations = findInjectUrlViolations(process.cwd());

  if (violations.length > 0) {
    console.error('Hardcoded /api/vN in inject url fields (use testApiPath()):\n');
    for (const { file, line } of violations) {
      console.error(`  - ${file}:${line}`);
    }
    console.error(
      '\nImport: import { testApiPath } from "@/tests/helpers/test-api-prefix.helper.js";',
    );
    process.exit(1);
  }
  console.log('✅ validate-test-api-prefix passed');
}

main();
