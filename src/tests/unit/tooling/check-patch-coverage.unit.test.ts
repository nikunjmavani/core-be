import { describe, expect, it } from 'vitest';
import {
  buildLineHitMap,
  computePatchCoverage,
  isMeasuredPath,
  parseAddedLines,
} from '@tooling/ci/check-patch-coverage.mjs';

describe('isMeasuredPath', () => {
  it('includes domain service/repository/controller files', () => {
    expect(isMeasuredPath('src/domains/billing/sub-domains/plan/plan.service.ts')).toBe(true);
    expect(isMeasuredPath('src/domains/auth/auth.repository.ts')).toBe(true);
    expect(isMeasuredPath('src/domains/notify/webhook.controller.ts')).toBe(true);
  });

  it('includes everything under src/shared', () => {
    expect(isMeasuredPath('src/shared/middlewares/core/idempotency.middleware.ts')).toBe(true);
    expect(isMeasuredPath('src/shared/utils/http/response.util.ts')).toBe(true);
  });

  it('excludes domain files outside the measured surface (validators, serializers, schemas, workers, dto)', () => {
    expect(isMeasuredPath('src/domains/billing/sub-domains/plan/plan.validator.ts')).toBe(false);
    expect(isMeasuredPath('src/domains/billing/sub-domains/plan/plan.serializer.ts')).toBe(false);
    expect(isMeasuredPath('src/domains/billing/sub-domains/plan/plan.schema.ts')).toBe(false);
    expect(isMeasuredPath('src/domains/notify/workers/notification.worker.ts')).toBe(false);
    expect(isMeasuredPath('src/domains/billing/sub-domains/plan/plan.dto.ts')).toBe(false);
  });

  it('excludes infrastructure, tests, scripts, __tests__ and type declarations', () => {
    expect(isMeasuredPath('src/infrastructure/queue/bootstrap.ts')).toBe(false);
    expect(isMeasuredPath('src/tests/helpers/test-app.ts')).toBe(false);
    expect(isMeasuredPath('src/scripts/seed/bulk.ts')).toBe(false);
    expect(isMeasuredPath('src/domains/billing/__tests__/factories/subscription.factory.ts')).toBe(
      false,
    );
    expect(isMeasuredPath('src/domains/auth/auth.service.test.ts')).toBe(false);
    expect(isMeasuredPath('src/shared/types/index.d.ts')).toBe(false);
    expect(isMeasuredPath('tooling/ci/check-patch-coverage.mjs')).toBe(false);
  });
});

describe('parseAddedLines', () => {
  it('parses added line ranges from a unified=0 diff', () => {
    const diff = [
      'diff --git a/src/domains/x/x.service.ts b/src/domains/x/x.service.ts',
      '--- a/src/domains/x/x.service.ts',
      '+++ b/src/domains/x/x.service.ts',
      '@@ -10,0 +11,3 @@',
      '+line a',
      '+line b',
      '+line c',
      '@@ -20,1 +24,1 @@',
      '-old',
      '+new',
    ].join('\n');

    const result = parseAddedLines(diff);
    expect(result.get('src/domains/x/x.service.ts')).toEqual(new Set([11, 12, 13, 24]));
  });

  it('ignores pure-deletion hunks (newCount = 0)', () => {
    const diff = [
      '+++ b/src/domains/x/x.service.ts',
      '@@ -5,3 +4,0 @@',
      '-gone 1',
      '-gone 2',
      '-gone 3',
    ].join('\n');
    const result = parseAddedLines(diff);
    expect(result.has('src/domains/x/x.service.ts')).toBe(false);
  });

  it('treats a hunk with no explicit count as a single added line', () => {
    const diff = ['+++ b/src/shared/util.ts', '@@ -7 +7 @@', '-old', '+new'].join('\n');
    const result = parseAddedLines(diff);
    expect(result.get('src/shared/util.ts')).toEqual(new Set([7]));
  });

  it('skips hunks for deleted files (+++ /dev/null)', () => {
    const diff = ['+++ /dev/null', '@@ -1,2 +0,0 @@', '-a', '-b'].join('\n');
    const result = parseAddedLines(diff);
    expect(result.size).toBe(0);
  });
});

describe('buildLineHitMap', () => {
  it('maps each statement start line to its max hit count', () => {
    const fileCoverage = {
      statementMap: {
        0: { start: { line: 10 } },
        1: { start: { line: 11 } },
        // two statements on the same line — line is covered if either ran
        2: { start: { line: 12 } },
        3: { start: { line: 12 } },
      },
      s: { 0: 3, 1: 0, 2: 0, 3: 7 },
    };
    const map = buildLineHitMap(fileCoverage);
    expect(map.get(10)).toBe(3);
    expect(map.get(11)).toBe(0);
    expect(map.get(12)).toBe(7); // max(0, 7)
  });
});

describe('computePatchCoverage', () => {
  const coverage = {
    '/repo/src/domains/x/x.service.ts': {
      statementMap: {
        0: { start: { line: 10 } },
        1: { start: { line: 11 } },
        2: { start: { line: 12 } },
      },
      s: { 0: 1, 1: 0, 2: 4 }, // line 10 covered, 11 uncovered, 12 covered
    },
  };

  it('counts only changed executable lines (covered / coverable)', () => {
    const addedLines = new Map([
      ['src/domains/x/x.service.ts', new Set([10, 11, 12, 99])], // 99 is not executable
    ]);
    const result = computePatchCoverage(coverage, addedLines);
    expect(result.totalCoverable).toBe(3); // 10, 11, 12 (99 excluded — no statement)
    expect(result.totalCovered).toBe(2); // 10, 12
    expect(result.overallPct).toBeCloseTo((2 / 3) * 100, 5);
    expect(result.perFile).toHaveLength(1);
    expect(result.uncoveredFiles).toHaveLength(0);
  });

  it('ignores changes to files outside the measured surface', () => {
    const addedLines = new Map([
      ['src/domains/x/x.validator.ts', new Set([1, 2, 3])], // not measured
      ['src/tests/helpers/x.ts', new Set([1, 2])], // not measured
    ]);
    const result = computePatchCoverage(coverage, addedLines);
    expect(result.totalCoverable).toBe(0);
    expect(result.overallPct).toBe(100); // nothing measurable → vacuously 100%
    expect(result.uncoveredFiles).toHaveLength(0);
  });

  it('flags an in-scope changed file with no coverage entry as uncovered', () => {
    const addedLines = new Map([
      ['src/domains/y/y.service.ts', new Set([1, 2])], // measured but absent from coverage
    ]);
    const result = computePatchCoverage(coverage, addedLines);
    expect(result.uncoveredFiles).toEqual(['src/domains/y/y.service.ts']);
  });

  it('reports 100% when every changed executable line is covered', () => {
    const addedLines = new Map([['src/domains/x/x.service.ts', new Set([10, 12])]]);
    const result = computePatchCoverage(coverage, addedLines);
    expect(result.overallPct).toBe(100);
    expect(result.totalCovered).toBe(2);
    expect(result.totalCoverable).toBe(2);
  });
});
