#!/usr/bin/env node
/**
 * Merges multiple istanbul-format `coverage-final.json` files (produced by
 * `@vitest/coverage-v8` with the `json` reporter) into a single coverage map,
 * computes a coverage summary across lines/statements/functions/branches, and
 * enforces minimum thresholds — exiting non-zero if any threshold is missed.
 *
 * Usage:
 *   node tooling/ci/merge-coverage-and-check-thresholds.mjs \
 *     coverage-fast/coverage-final.json \
 *     coverage-db-bound/coverage-final.json \
 *     [--output coverage-merged/coverage-final.json] \
 *     [--lines 80] [--branches 70] [--statements 80] [--functions 80] \
 *     [--report-only]
 *
 * Vitest applies coverage thresholds *per process*, so when CI splits tests
 * across matrix shards each shard fails the global threshold even when the
 * union of shards exceeds it. Disable thresholds per shard
 * (`--coverage.thresholds.*=0`) and gate the merged report with this script.
 *
 * `--report-only` prints the summary and threshold comparison without exiting
 * non-zero on misses. Used by CI in smart mode, where only tests touched by
 * the PR diff run and the merged report cannot meet a full-matrix threshold.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
/**
 * Single source of truth for coverage thresholds — also consumed by
 * `vitest.config.ts` so local `pnpm test:coverage` and the CI merged gate
 * enforce the same numbers.
 */
const sharedThresholdsPath = resolve(scriptDirectory, 'coverage-thresholds.json');
const DEFAULT_THRESHOLDS = JSON.parse(readFileSync(sharedThresholdsPath, 'utf8'));

function parseArguments(argv) {
  const inputs = [];
  const thresholds = { ...DEFAULT_THRESHOLDS };
  let outputPath = null;
  let reportOnly = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '') continue;
    if (token === '--output' || token === '-o') {
      outputPath = argv[index + 1];
      index += 1;
      continue;
    }
    if (token === '--report-only') {
      reportOnly = true;
      continue;
    }
    const thresholdKey = ['lines', 'branches', 'statements', 'functions'].find(
      (key) => token === `--${key}`,
    );
    if (thresholdKey) {
      thresholds[thresholdKey] = Number(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      throw new Error(`Unknown flag: ${token}`);
    }
    inputs.push(token);
  }
  if (inputs.length === 0) {
    throw new Error('No coverage inputs provided. Pass one or more `coverage-final.json` paths.');
  }
  return { inputs, thresholds, outputPath, reportOnly };
}

function mergeFileCoverage(target, source) {
  for (const statementId of Object.keys(source.s)) {
    target.s[statementId] = (target.s[statementId] ?? 0) + source.s[statementId];
  }
  for (const functionId of Object.keys(source.f)) {
    target.f[functionId] = (target.f[functionId] ?? 0) + source.f[functionId];
  }
  for (const branchId of Object.keys(source.b)) {
    if (!target.b[branchId]) {
      target.b[branchId] = source.b[branchId].slice();
      continue;
    }
    for (let branchIndex = 0; branchIndex < source.b[branchId].length; branchIndex += 1) {
      target.b[branchId][branchIndex] =
        (target.b[branchId][branchIndex] ?? 0) + (source.b[branchId][branchIndex] ?? 0);
    }
  }
}

function loadCoverage(inputPath) {
  const absolutePath = resolve(process.cwd(), inputPath);
  const raw = readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

function computeSummary(merged) {
  let statementsTotal = 0;
  let statementsCovered = 0;
  let functionsTotal = 0;
  let functionsCovered = 0;
  let branchesTotal = 0;
  let branchesCovered = 0;
  let linesTotal = 0;
  let linesCovered = 0;

  for (const filePath of Object.keys(merged)) {
    const fileCoverage = merged[filePath];

    for (const statementId of Object.keys(fileCoverage.s)) {
      statementsTotal += 1;
      if (fileCoverage.s[statementId] > 0) statementsCovered += 1;
    }
    for (const functionId of Object.keys(fileCoverage.f)) {
      functionsTotal += 1;
      if (fileCoverage.f[functionId] > 0) functionsCovered += 1;
    }
    for (const branchId of Object.keys(fileCoverage.b)) {
      for (const hits of fileCoverage.b[branchId]) {
        branchesTotal += 1;
        if (hits > 0) branchesCovered += 1;
      }
    }

    /**
     * Line coverage is derived from statementMap: each line is covered if any
     * statement starting on that line was executed at least once. Mirrors the
     * istanbul-lib-coverage `FileCoverage.toSummary()` heuristic.
     */
    const lineHits = new Map();
    for (const statementId of Object.keys(fileCoverage.statementMap)) {
      const lineNumber = fileCoverage.statementMap[statementId].start.line;
      const previousHits = lineHits.get(lineNumber) ?? 0;
      const statementHits = fileCoverage.s[statementId] ?? 0;
      lineHits.set(lineNumber, Math.max(previousHits, statementHits));
    }
    for (const hits of lineHits.values()) {
      linesTotal += 1;
      if (hits > 0) linesCovered += 1;
    }
  }

  const percentage = (covered, total) => (total === 0 ? 100 : (covered / total) * 100);

  return {
    lines: { covered: linesCovered, total: linesTotal, pct: percentage(linesCovered, linesTotal) },
    statements: {
      covered: statementsCovered,
      total: statementsTotal,
      pct: percentage(statementsCovered, statementsTotal),
    },
    functions: {
      covered: functionsCovered,
      total: functionsTotal,
      pct: percentage(functionsCovered, functionsTotal),
    },
    branches: {
      covered: branchesCovered,
      total: branchesTotal,
      pct: percentage(branchesCovered, branchesTotal),
    },
  };
}

function main() {
  const { inputs, thresholds, outputPath, reportOnly } = parseArguments(process.argv.slice(2));

  const merged = {};
  for (const inputPath of inputs) {
    const coverage = loadCoverage(inputPath);
    for (const filePath of Object.keys(coverage)) {
      if (!merged[filePath]) {
        merged[filePath] = JSON.parse(JSON.stringify(coverage[filePath]));
        continue;
      }
      mergeFileCoverage(merged[filePath], coverage[filePath]);
    }
    console.log(`Loaded ${Object.keys(coverage).length} files from ${inputPath}`);
  }
  console.log(`Merged total: ${Object.keys(merged).length} unique files`);

  if (outputPath) {
    const absoluteOutputPath = resolve(process.cwd(), outputPath);
    mkdirSync(dirname(absoluteOutputPath), { recursive: true });
    writeFileSync(absoluteOutputPath, JSON.stringify(merged));
    console.log(`Wrote merged coverage to ${absoluteOutputPath}`);
  }

  const summary = computeSummary(merged);

  console.log('\nMerged coverage summary:');
  for (const metric of ['lines', 'statements', 'functions', 'branches']) {
    const entry = summary[metric];
    console.log(
      `  ${metric.padEnd(11)}: ${entry.pct.toFixed(2).padStart(6)}% (${entry.covered}/${entry.total})`,
    );
  }

  console.log('\nThreshold check:');
  let failed = false;
  for (const metric of ['lines', 'branches', 'statements', 'functions']) {
    const actual = summary[metric].pct;
    const required = thresholds[metric];
    const status = actual >= required ? 'OK' : 'FAIL';
    console.log(
      `  ${metric.padEnd(11)}: ${actual.toFixed(2).padStart(6)}% (threshold ${required}%) [${status}]`,
    );
    if (actual < required) failed = true;
  }

  if (failed) {
    if (reportOnly) {
      console.warn(
        '\nCoverage thresholds not met across merged shards (report-only mode — not failing).',
      );
      return;
    }
    console.error('\nCoverage thresholds not met across merged shards.');
    process.exit(1);
  }

  console.log('\nAll thresholds met across merged shards.');
}

try {
  main();
} catch (error) {
  console.error(`merge-coverage-and-check-thresholds: ${error.message}`);
  process.exit(2);
}
