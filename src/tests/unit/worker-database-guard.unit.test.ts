import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const FORBIDDEN_PATTERNS: { pattern: RegExp; message: string }[] = [
  {
    pattern: /\bgetRequestDatabase\s*\(/,
    message: 'must not call getRequestDatabase()',
  },
  {
    pattern: /from\s+['"]@\/infrastructure\/database\/request-database\.context\.js['"]/,
    message: 'must not import request-database.context',
  },
  {
    pattern:
      /import\s*\{[^}]*\bdatabase\b[^}]*\}\s*from\s*['"]@\/infrastructure\/database\/connection\.js['"]/,
    message: 'must not import the global database pool singleton',
  },
];

function walkTypeScriptFiles(directory: string, results: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkTypeScriptFiles(absolutePath, results);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      results.push(relative(process.cwd(), absolutePath));
    }
  }
  return results;
}

function listWorkerProcessorFiles(): string[] {
  const sourceRoot = join(process.cwd(), 'src');
  return walkTypeScriptFiles(sourceRoot).filter((filePath) => {
    return (
      filePath.endsWith('.worker.ts') ||
      filePath.endsWith('.processor.ts') ||
      filePath.includes('/workers/') ||
      filePath.endsWith('batch-delete.util.ts')
    );
  });
}

describe('worker database guard (static scan)', () => {
  const files = [...new Set(listWorkerProcessorFiles())].sort();

  it('discovers worker and processor source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const filePath of files) {
    it(`${filePath} avoids request-scoped database fallbacks`, () => {
      const source = readFileSync(filePath, 'utf8');
      for (const { pattern, message } of FORBIDDEN_PATTERNS) {
        expect(source, `${filePath}: ${message}`).not.toMatch(pattern);
      }
    });
  }
});
