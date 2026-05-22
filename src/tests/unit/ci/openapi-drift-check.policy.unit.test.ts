import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readWorkflow(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function resolveDocsCheckScript(command: string): string {
  const match = command.match(/tsx\s+(\S+)/);
  if (!match) {
    throw new Error(`docs:check script does not invoke tsx with a path: ${command}`);
  }
  return join(ROOT, match[1] ?? '');
}

describe('OpenAPI drift check policy', () => {
  it('runs docs:check in ci:quality and quality-static workflow', () => {
    const packageJson = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const docsCheckCommand = packageJson.scripts['docs:check'];
    expect(docsCheckCommand).toBeDefined();

    const scriptPath = resolveDocsCheckScript(docsCheckCommand ?? '');
    expect(existsSync(scriptPath)).toBe(true);
    expect(scriptPath).toContain('src/scripts/codegen/check-api-docs-sync.ts');

    expect(packageJson.scripts['ci:quality']).toMatch(/pnpm docs:check/);

    const qualityStatic = readWorkflow('.github/workflows/reusable-quality-static.yml');
    expect(qualityStatic).toContain('pnpm docs:check');

    const docsGenerate = readWorkflow('.github/workflows/reusable-openapi-postman-publish.yml');
    expect(docsGenerate).toContain('pnpm docs:check');
  });
});
