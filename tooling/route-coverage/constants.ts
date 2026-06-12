/**
 * Shared constants for the observed route success-status coverage gate.
 *
 * The test-app helper (`src/tests/helpers/route-status-observer.ts`) records
 * `"METHOD /route/pattern status"` lines under the observed directory during
 * test runs; `pnpm validate:route-success-coverage` evaluates them against the
 * declared success-status map and the committed budget below.
 */

/** Directory (repo-root relative) where test runs flush observed route-status lines. */
export const ROUTE_COVERAGE_OBSERVED_DIRECTORY_NAME = 'route-coverage-observed';

/** Repo-root relative path of the committed uncovered-routes budget (ratchet). */
export const ROUTE_SUCCESS_COVERAGE_BUDGET_PATH =
  'tooling/route-coverage/route-success-coverage-budget.json';
