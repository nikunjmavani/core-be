/**
 * Type declarations for `check-patch-coverage.mjs` (plain-JS CLI run via `node`
 * in CI; typed here so unit tests and importers get type checking).
 */

/** A single file's istanbul coverage entry (the subset this tool reads). */
export interface IstanbulFileCoverage {
  statementMap?: Record<string, { start: { line: number } }>;
  s?: Record<string, number>;
  [key: string]: unknown;
}

/** Parsed CLI arguments. */
export interface PatchCoverageArguments {
  coveragePath: string;
  base: string;
  threshold: number;
  reportOnly: boolean;
}

/** Per-file patch-coverage entry. */
export interface PatchCoverageFileResult {
  relativePath: string;
  covered: number;
  coverable: number;
  pct: number;
}

/** Result of {@link computePatchCoverage}. */
export interface PatchCoverageResult {
  overallPct: number;
  totalCovered: number;
  totalCoverable: number;
  perFile: PatchCoverageFileResult[];
  uncoveredFiles: string[];
}

export function parseArguments(argv: string[]): PatchCoverageArguments;

export function parseAddedLines(diffText: string): Map<string, Set<number>>;

export function isMeasuredPath(relativePath: string): boolean;

export function buildLineHitMap(fileCoverage: IstanbulFileCoverage): Map<number, number>;

export function computePatchCoverage(
  coverage: Record<string, IstanbulFileCoverage>,
  addedLines: Map<string, Set<number>>,
): PatchCoverageResult;
