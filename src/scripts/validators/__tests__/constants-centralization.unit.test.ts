import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  findDuplicateLiteralViolations,
  loadCanonicalConstantValues,
} from '@/scripts/validators/code/constants-centralization.util.js';

describe('constants-centralization.util', () => {
  it('loads canonical numeric values from shared constants', () => {
    const values = loadCanonicalConstantValues();
    expect(values.has(900)).toBe(true);
    expect(values.has(15)).toBe(true);
    expect(values.has(500)).toBe(true);
  });
});

describe('findDuplicateLiteralViolations', () => {
  let tempRoot = '';

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'constants-centralization-'));
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);

    mkdirSync(join(tempRoot, 'src/shared/constants'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'src/shared/constants/ttl.constants.ts'),
      'export const ACCESS_TOKEN_EXPIRY_SECONDS = 900;\n',
    );

    mkdirSync(join(tempRoot, 'src/domains/example'), { recursive: true });
    mkdirSync(join(tempRoot, 'src/infrastructure'), { recursive: true });
    mkdirSync(join(tempRoot, 'src/shared/utils'), { recursive: true });
    mkdirSync(join(tempRoot, 'src/core'), { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the same non-canonical literal in two files', () => {
    writeFileSync(
      join(tempRoot, 'src/domains/example/a.service.ts'),
      'export const LEASE_MINUTES = 77_777;\n',
    );
    writeFileSync(
      join(tempRoot, 'src/domains/example/b.service.ts'),
      'const RETRY_AFTER = 77_777;\n',
    );

    const violations = findDuplicateLiteralViolations();
    expect(violations.some((violation) => violation.value === 77_777)).toBe(true);
  });

  it('ignores literals that are canonical in shared constants', () => {
    writeFileSync(
      join(tempRoot, 'src/domains/example/token.service.ts'),
      'const expiresInSeconds = 900;\n',
    );
    writeFileSync(join(tempRoot, 'src/shared/utils/other.util.ts'), 'const ttl = 900;\n');

    const violations = findDuplicateLiteralViolations();
    expect(violations.some((violation) => violation.value === 900)).toBe(false);
  });
});
