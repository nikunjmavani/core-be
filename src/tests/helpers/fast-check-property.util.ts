import type { Parameters } from 'fast-check';

/** Default runs locally; CI sets `FAST_CHECK_NUM_RUNS` for a bounded budget. */
export const PROPERTY_TEST_NUM_RUNS = Number(process.env.FAST_CHECK_NUM_RUNS ?? 100);

/** Subset of fast-check run options shared by property suites (no `examples` — tuple-specific). */
export type PropertyAssertRunOptions = Pick<
  Parameters,
  'numRuns' | 'endOnFailure' | 'interruptAfterTimeLimit' | 'maxSkipsPerRun'
>;

/** Shared fast-check options: bounded runs, stop on first failure, shrink with skip budget. */
export function propertyAssertOptions(): PropertyAssertRunOptions {
  return {
    numRuns: PROPERTY_TEST_NUM_RUNS,
    endOnFailure: true,
    interruptAfterTimeLimit: 60_000,
    maxSkipsPerRun: 100,
  };
}
