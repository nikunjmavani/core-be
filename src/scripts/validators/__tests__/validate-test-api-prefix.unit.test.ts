import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { findInjectUrlViolations } from '../tests/validate-test-api-prefix.js';

describe('validate-test-api-prefix', () => {
  it('passes when inject urls use testApiPath', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'test-api-prefix-'));
    const testDirectory = join(temporaryRoot, 'src', 'tests', 'unit');
    mkdirSync(testDirectory, { recursive: true });
    writeFileSync(
      join(testDirectory, 'sample.unit.test.ts'),
      `import { testApiPath } from '@/tests/helpers/test-api-prefix.helper.js';
it('calls API', async () => {
  await app.inject({ method: 'GET', url: testApiPath('/users/me') });
});
describe('GET /api/v1/users/me', () => {
  it('is only a title', () => {});
});
`,
      'utf-8',
    );

    try {
      expect(findInjectUrlViolations(temporaryRoot, temporaryRoot)).toEqual([]);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('fails on hardcoded /api/v1 in inject url fields', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'test-api-prefix-'));
    const testDirectory = join(temporaryRoot, 'src', 'domains', 'demo', '__tests__');
    mkdirSync(testDirectory, { recursive: true });
    const hardcodedInjectLine = [
      "  await app.inject({ method: 'GET', url: '",
      '/api/v1/users/me',
      "' });",
    ].join('');
    writeFileSync(
      join(testDirectory, 'demo.integration.test.ts'),
      ['it("uses hardcoded prefix", async () => {', hardcodedInjectLine, '});'].join('\n'),
      'utf-8',
    );

    try {
      const violations = findInjectUrlViolations(temporaryRoot, temporaryRoot);
      expect(violations).toHaveLength(1);
      expect(violations[0]?.file).toContain('demo.integration.test.ts');
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('flags /api/v2 in inject url fields', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'test-api-prefix-'));
    const testDirectory = join(temporaryRoot, 'src', 'tests');
    mkdirSync(testDirectory, { recursive: true });
    const futureInjectLine = [
      "await app.inject({ method: 'GET', url: '",
      '/api/v2/users/me',
      "' });",
    ].join('');
    writeFileSync(join(testDirectory, 'future.unit.test.ts'), futureInjectLine, 'utf-8');

    try {
      expect(findInjectUrlViolations(temporaryRoot, temporaryRoot)).toHaveLength(1);
    } finally {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
