#!/usr/bin/env node
/**
 * Differential ("patch") coverage gate.
 *
 * Computes the line-coverage percentage of the lines a change *added or
 * modified* — not the whole tree — and enforces a high bar on that subset.
 * This keeps new code well-tested without forcing a retro-fit of the entire
 * codebase, and it cannot regress: every PR is measured against its own diff.
 *
 * Why this exists: the global merged gate
 * (`merge-coverage-and-check-thresholds.mjs`) measures the union of all source
 * files and moves slowly. Patch coverage is the high-leverage complement —
 * it holds the *delta* to a stricter standard (default 90% of changed,
 * coverable lines).
 *
 * Usage:
 *   node tooling/ci/check-patch-coverage.mjs \
 *     --coverage coverage-merged/coverage-final.json \
 *     --base origin/dev \
 *     [--threshold 90] \
 *     [--report-only]
 *
 * Inputs:
 *   --coverage  Path to an istanbul-format `coverage-final.json` (the merged
 *               report is preferred so integration/e2e hits are included).
 *   --base      Git ref to diff against (the PR base, e.g. `origin/dev`).
 *               The added/modified lines are taken from `git diff <base>...HEAD`.
 *   --threshold Minimum percentage of changed coverable lines that must be
 *               covered. Default 90.
 *   --report-only  Print the report without exiting non-zero on a miss.
 *
 * A changed line is "coverable" only if the coverage map has a statement
 * starting on that line (mirrors the line-coverage heuristic used by the merged
 * gate). Comments, blank lines, type-only lines, and import lines with no
 * executable statement are excluded — so the denominator is executable new code.
 *
 * Measured surface (mirrors `vitest.config.ts` `coverage.include`/`exclude`):
 * only domain `*.service.ts`, `*.repository.ts`, `*.controller.ts` files and
 * everything under `src/shared/` count. Validators, serializers, schemas,
 * workers, DTOs, `src/infrastructure/`, tests, scripts, and `__tests__/` are
 * outside the coverage scope and are therefore excluded from patch coverage too
 * — a change to those files neither helps nor hurts the patch number. Keeping
 * this in lock step with the global coverage scope is what makes the metric
 * honest.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const DEFAULT_THRESHOLD = 90;

function parseArguments(argv) {
  let coveragePath = null;
  let base = null;
  let threshold = DEFAULT_THRESHOLD;
  let reportOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '') continue;
    if (token === '--coverage') {
      coveragePath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--base') {
      base = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--threshold') {
      threshold = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === '--report-only') {
      reportOnly = true;
      continue;
    }
    throw new Error(`Unknown flag: ${token}`);
  }
  if (!coveragePath) throw new Error('Missing --coverage <coverage-final.json>');
  if (!base) throw new Error('Missing --base <git-ref>');
  if (!Number.isFinite(threshold)) throw new Error('--threshold must be a number');
  return { coveragePath, base, threshold, reportOnly };
}

/**
 * Returns true when a path is inside the measured coverage surface — i.e. it
 * would be instrumented by `vitest.config.ts` `coverage.include`/`exclude`.
 * Only these files contribute to patch coverage. Mirrors that config:
 *   include — domain service/repository/controller files; all of src/shared
 *   exclude — src/tests, src/scripts, any __tests__ directory, and .d.ts files
 */
function isMeasuredPath(relativePath) {
  if (!relativePath.endsWith('.ts')) return false;
  if (relativePath.endsWith('.d.ts')) return false;
  // Excludes take precedence over includes.
  if (relativePath.startsWith('src/tests/')) return false;
  if (relativePath.startsWith('src/scripts/')) return false;
  if (relativePath.includes('/__tests__/')) return false;
  // Includes.
  if (relativePath.startsWith('src/shared/')) return true;
  if (
    relativePath.startsWith('src/domains/') &&
    /\.(service|repository|controller)\.ts$/.test(relativePath)
  ) {
    return true;
  }
  return false;
}

/**
 * Parses `git diff --unified=0` output into a map of relative file path →
 * Set of added/modified line numbers (on the new side of the diff).
 */
function parseAddedLines(diffText) {
  const fileToLines = new Map();
  let currentFile = null;
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      // `+++ b/path` (or `+++ /dev/null` for deletions)
      const pathPart = line.slice(4).trim();
      currentFile = pathPart === '/dev/null' ? null : pathPart.replace(/^b\//, '');
      continue;
    }
    if (line.startsWith('@@')) {
      // `@@ -oldStart,oldCount +newStart,newCount @@`
      const match = /\+(\d+)(?:,(\d+))?/.exec(line);
      if (!(match && currentFile)) continue;
      const start = Number(match[1]);
      const count = match[2] === undefined ? 1 : Number(match[2]);
      if (count === 0) continue; // pure deletion hunk
      if (!fileToLines.has(currentFile)) fileToLines.set(currentFile, new Set());
      const set = fileToLines.get(currentFile);
      for (let lineNumber = start; lineNumber < start + count; lineNumber += 1) {
        set.add(lineNumber);
      }
    }
  }
  return fileToLines;
}

/**
 * Builds a map of line number → max statement hits for a single file's istanbul
 * coverage entry. A line is coverable when it appears here; covered when its
 * value is > 0.
 */
function buildLineHitMap(fileCoverage) {
  const lineHits = new Map();
  for (const statementId of Object.keys(fileCoverage.statementMap ?? {})) {
    const lineNumber = fileCoverage.statementMap[statementId].start.line;
    const previous = lineHits.get(lineNumber) ?? 0;
    const hits = fileCoverage.s[statementId] ?? 0;
    lineHits.set(lineNumber, Math.max(previous, hits));
  }
  return lineHits;
}

function buildCoverageIndex(coverage) {
  // Index istanbul coverage by relative `src/...` suffix for matching against
  // git paths, which are repo-relative.
  const index = new Map();
  for (const absolutePath of Object.keys(coverage)) {
    const normalized = absolutePath.replace(/\\/g, '/');
    const srcIndex = normalized.lastIndexOf('/src/');
    const relative = srcIndex >= 0 ? normalized.slice(srcIndex + 1) : normalized;
    index.set(relative, coverage[absolutePath]);
  }
  return index;
}

/**
 * Pure core: given an istanbul coverage map and a map of changed file →
 * added-line numbers, computes per-file and overall patch coverage over the
 * measured surface. No I/O — unit-testable.
 *
 * @param {Record<string, object>} coverage istanbul coverage-final.json map
 * @param {Map<string, Set<number>>} addedLines changed file → added line numbers
 * @returns {{ overallPct: number, totalCovered: number, totalCoverable: number,
 *   perFile: Array<{relativePath: string, covered: number, coverable: number, pct: number}>,
 *   uncoveredFiles: string[] }}
 */
function computePatchCoverage(coverage, addedLines) {
  const coverageIndex = buildCoverageIndex(coverage);
  let totalCoverable = 0;
  let totalCovered = 0;
  const perFile = [];
  const uncoveredFiles = [];

  for (const [relativePath, lineSet] of addedLines) {
    if (!isMeasuredPath(relativePath)) continue;
    const fileCoverage = coverageIndex.get(relativePath);
    if (!fileCoverage) {
      // Changed in-scope source file with no coverage entry → its executable
      // new lines are entirely uncovered. Surface it explicitly.
      uncoveredFiles.push(relativePath);
      continue;
    }
    const lineHits = buildLineHitMap(fileCoverage);
    let coverable = 0;
    let covered = 0;
    for (const lineNumber of lineSet) {
      if (!lineHits.has(lineNumber)) continue; // not an executable line
      coverable += 1;
      if (lineHits.get(lineNumber) > 0) covered += 1;
    }
    if (coverable === 0) continue;
    totalCoverable += coverable;
    totalCovered += covered;
    perFile.push({ relativePath, coverable, covered, pct: (covered / coverable) * 100 });
  }

  const overallPct = totalCoverable === 0 ? 100 : (totalCovered / totalCoverable) * 100;
  return { overallPct, totalCovered, totalCoverable, perFile, uncoveredFiles };
}

function main() {
  const { coveragePath, base, threshold, reportOnly } = parseArguments(process.argv.slice(2));

  const coverage = JSON.parse(readFileSync(resolve(process.cwd(), coveragePath), 'utf8'));
  const diffText = execFileSync('git', ['diff', '--unified=0', '--no-color', `${base}...HEAD`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const addedLines = parseAddedLines(diffText);
  const { overallPct, totalCovered, totalCoverable, perFile, uncoveredFiles } =
    computePatchCoverage(coverage, addedLines);

  console.log('Patch coverage (changed, executable lines):');
  if (perFile.length === 0 && uncoveredFiles.length === 0) {
    console.log('  No changed production source lines to measure.');
  }
  for (const entry of perFile.sort((a, b) => a.pct - b.pct)) {
    const flag = entry.pct + 1e-9 < threshold ? ' ⚠' : '';
    console.log(
      `  ${entry.pct.toFixed(2).padStart(6)}%  ${entry.covered}/${entry.coverable}  ${entry.relativePath}${flag}`,
    );
  }
  for (const filePath of uncoveredFiles) {
    console.log(`   0.00%  (no coverage data)  ${filePath} ⚠`);
  }

  console.log(
    `\nOverall patch coverage: ${overallPct.toFixed(2)}% (${totalCovered}/${totalCoverable}) — threshold ${threshold}%`,
  );

  const missed = overallPct + 1e-9 < threshold || uncoveredFiles.length > 0;
  if (missed) {
    if (reportOnly) {
      console.warn('\nPatch coverage below threshold (report-only mode — not failing).');
      return;
    }
    console.error('\nPatch coverage below threshold.');
    process.exit(1);
  }
  console.log('\nPatch coverage meets the threshold.');
}

export { parseArguments, parseAddedLines, isMeasuredPath, buildLineHitMap, computePatchCoverage };

// Run as CLI only when invoked directly (not when imported by tests).
const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    main();
  } catch (error) {
    console.error(`check-patch-coverage: ${error.message}`);
    process.exit(2);
  }
}
