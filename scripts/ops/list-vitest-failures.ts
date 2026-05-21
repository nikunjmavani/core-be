/**
 * Reads Vitest JSON output and writes a human-readable failure list.
 * Usage: pnpm exec vitest run --no-file-parallelism --reporter=json --outputFile=/tmp/vitest-results.json
 *        pnpm exec tsx scripts/ops/list-vitest-failures.ts /tmp/vitest-results.json failed-tests-report.md
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type AssertionResult = {
  status: string;
  fullName?: string;
  title: string;
  failureMessages?: string[];
};

type TestResult = {
  name: string;
  status: string;
  assertionResults?: AssertionResult[];
};

type VitestJson = {
  numTotalTests?: number;
  numPassedTests?: number;
  numFailedTests?: number;
  numSkippedTests?: number;
  testResults?: TestResult[];
};

function main(): void {
  const inputPath = resolve(process.argv[2] ?? '/tmp/vitest-results.json');
  const outputPath = resolve(process.argv[3] ?? 'failed-tests-report.md');

  const report: VitestJson = JSON.parse(readFileSync(inputPath, 'utf8'));
  const failed: { file: string; test: string; message: string }[] = [];

  for (const fileResult of report.testResults ?? []) {
    if (fileResult.status === 'passed') continue;
    for (const assertion of fileResult.assertionResults ?? []) {
      if (assertion.status !== 'failed') continue;
      const rawMessage = assertion.failureMessages?.[0] ?? '';
      const message = rawMessage
        .split('\n')
        .slice(0, 6)
        .join('\n')
        .trim();
      failed.push({
        file: fileResult.name,
        test: assertion.fullName ?? assertion.title,
        message,
      });
    }
  }

  const byFile = new Map<string, typeof failed>();
  for (const entry of failed) {
    const group = byFile.get(entry.file) ?? [];
    group.push(entry);
    byFile.set(entry.file, group);
  }

  const lines: string[] = [
    '# Failed tests report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    '| Metric | Count |',
    '|--------|------:|',
    `| Total | ${report.numTotalTests ?? '—'} |`,
    `| Passed | ${report.numPassedTests ?? '—'} |`,
    `| Failed | ${report.numFailedTests ?? failed.length} |`,
    `| Skipped | ${report.numSkippedTests ?? '—'} |`,
    '',
    `**Failed test cases: ${failed.length}** (grouped by file)`,
    '',
  ];

  const sortedFiles = [...byFile.keys()].sort();
  for (const file of sortedFiles) {
    const entries = byFile.get(file)!;
    lines.push(`## ${file}`, '');
    for (const [index, entry] of entries.entries()) {
      lines.push(`### ${index + 1}. ${entry.test}`, '');
      lines.push('```');
      lines.push(entry.message || '(no message)');
      lines.push('```', '');
    }
  }

  writeFileSync(outputPath, lines.join('\n'), 'utf8');
  console.log(`Wrote ${failed.length} failures across ${sortedFiles.length} files → ${outputPath}`);
}

main();
