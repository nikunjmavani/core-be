/**
 * Observed route success-status coverage gate (budget-driven ratchet).
 *
 * Reads the `"METHOD /route/pattern status"` lines flushed by test runs
 * (`route-coverage-observed/`, written by `createTestApp()`'s observer) and:
 *
 *   1. **Drift (hard failure)** — an observed 2xx/3xx on a catalog route that
 *      differs from the declared status in `route-success-statuses.json`
 *      means the map or the controller is wrong. Always reported; blocks
 *      unless `--report-only`.
 *   2. **Coverage ratchet** — counts catalog routes whose declared happy-path
 *      status was never observed. The count may not exceed
 *      `tooling/route-coverage/route-success-coverage-budget.json`
 *      (`maxUncoveredRoutes`); lower it as coverage improves. Target: 0.
 *
 * Run after the FULL suite (`pnpm test`) — partial runs under-observe and
 * fail the budget. `pnpm test` wipes the observed directory at start.
 *
 * Usage:
 *   pnpm validate:route-success-coverage
 *   pnpm validate:route-success-coverage --observed-dir <dir> [--report-only]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadRouteRegistryFromCatalog } from '@/tests/helpers/route-catalog-registry.js';
import {
  loadRouteSuccessStatusMap,
  routeSuccessStatusKey,
} from '@/tests/helpers/route-success-status.helper.js';
import {
  evaluateRouteSuccessCoverage,
  findUndocumentedObservedStatuses,
} from '@/scripts/validators/routes/route-success-coverage.util.js';
import {
  ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME,
  ROUTE_SUCCESS_COVERAGE_BUDGET_PATH,
} from '@tooling/route-coverage/constants.js';

type CoverageBudget = {
  maxUncoveredRoutes: number;
};

function parseArguments(argv: string[]): { observedDirectories: string[]; reportOnly: boolean } {
  const observedDirectories: string[] = [];
  let reportOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--report-only') {
      reportOnly = true;
      continue;
    }
    if (argument === '--observed-dir') {
      const value = argv[index + 1];
      if (!value) {
        console.error('--observed-dir requires a path argument');
        process.exit(1);
      }
      observedDirectories.push(value);
      index += 1;
    }
  }
  if (observedDirectories.length === 0) {
    observedDirectories.push(ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME);
  }
  return { observedDirectories, reportOnly };
}

function collectObservedFiles(directory: string, collected: string[]): void {
  if (!existsSync(directory)) {
    return;
  }
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      collectObservedFiles(fullPath, collected);
    } else if (entry.endsWith('.txt')) {
      collected.push(fullPath);
    }
  }
}

function main(): void {
  const { observedDirectories, reportOnly } = parseArguments(process.argv.slice(2));

  const observedFiles: string[] = [];
  for (const directory of observedDirectories) {
    collectObservedFiles(resolve(process.cwd(), directory), observedFiles);
  }

  const exitFailure = (): never => {
    if (reportOnly) {
      console.error('\n(report-only mode — not failing the build)');
      process.exit(0);
    }
    process.exit(1);
  };

  if (observedFiles.length === 0) {
    console.error(
      `No observed route-status files (*.txt) found under: ${observedDirectories.join(', ')}.\n` +
        'Run the full suite first (pnpm test) — it wipes and repopulates route-coverage-observed/.',
    );
    exitFailure();
  }

  const observedLines = observedFiles.flatMap((file) => readFileSync(file, 'utf-8').split('\n'));

  const result = evaluateRouteSuccessCoverage({
    registry: loadRouteRegistryFromCatalog(),
    successStatusMap: loadRouteSuccessStatusMap(),
    observedLines,
  });

  const budget = JSON.parse(
    readFileSync(resolve(process.cwd(), ROUTE_SUCCESS_COVERAGE_BUDGET_PATH), 'utf-8'),
  ) as CoverageBudget;

  console.log(
    `Observed files: ${observedFiles.length} · covered routes: ${result.coveredRoutes.length} · ` +
      `uncovered: ${result.uncoveredRoutes.length} (budget ${budget.maxUncoveredRoutes})`,
  );

  if (result.driftFailures.length > 0) {
    console.error('\nDeclared-vs-observed success-status drift:');
    for (const failure of result.driftFailures) {
      console.error(`  - ${failure}`);
    }
    exitFailure();
  }

  if (result.uncoveredRoutes.length > budget.maxUncoveredRoutes) {
    console.error(
      `\nUncovered routes (${result.uncoveredRoutes.length}) exceed the budget (${budget.maxUncoveredRoutes}).`,
    );
    console.error(
      'Add an e2e/integration test that exercises the declared happy path, or — only with a reviewed reason — raise the budget:',
    );
    for (const key of result.uncoveredRoutes) {
      console.error(`  - ${key}`);
    }
    exitFailure();
  }

  if (result.uncoveredRoutes.length < budget.maxUncoveredRoutes) {
    console.log(
      `Coverage improved — lower maxUncoveredRoutes to ${result.uncoveredRoutes.length} in ${ROUTE_SUCCESS_COVERAGE_BUDGET_PATH} to lock it in.`,
    );
  }

  // Error-side check: every observed sub-500 status must appear in the
  // generated OpenAPI document. Runs only when the spec artifact exists
  // (ci:local generates it via docs:check; the CI coverage job runs
  // `pnpm docs:generate` first). Routes outside the public spec are skipped.
  const specPath = resolve(process.cwd(), 'docs', 'openapi', 'openapi.json');
  if (existsSync(specPath)) {
    const spec = JSON.parse(readFileSync(specPath, 'utf-8')) as {
      paths: Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    };
    const registry = loadRouteRegistryFromCatalog();
    const documentedStatusesByKey = new Map<string, ReadonlySet<string>>();
    for (const route of registry) {
      const specPathKey = route.path.replace(/:([A-Za-z_]+)/g, '{$1}');
      const operation = spec.paths[specPathKey]?.[route.method.toLowerCase()];
      if (operation?.responses) {
        documentedStatusesByKey.set(
          routeSuccessStatusKey(route),
          new Set(Object.keys(operation.responses)),
        );
      }
    }
    const undocumented = findUndocumentedObservedStatuses({
      registry,
      observedLines,
      documentedStatusesByKey,
    });
    if (undocumented.length > 0) {
      console.error('\nObserved statuses missing from the OpenAPI document:');
      for (const failure of undocumented) {
        console.error(`  - ${failure}`);
      }
      console.error(
        'Document the status in tooling/openapi/emitters/responses-builder.ts (or fix the route).',
      );
      exitFailure();
    }
    console.log(
      `Error-status documentation check passed (${documentedStatusesByKey.size} routes in spec).`,
    );
  } else {
    console.log('OpenAPI artifact not found — skipped the error-status documentation check.');
  }

  console.log('✅ validate-route-success-coverage passed');
}

main();
