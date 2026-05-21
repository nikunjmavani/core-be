import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

/** Runtime SDK wrappers — only these files may import stripe, resend, or @aws-sdk/client-s3. */
const EXTERNAL_SDK_ALLOWLIST = [
  'src/infrastructure/payment/stripe.client.ts',
  'src/infrastructure/mail/mail.service.ts',
  'src/infrastructure/storage/s3-adapter.ts',
  'src/infrastructure/storage/storage.service.ts',
] as const;

const SDK_IMPORT_PATTERNS: { pattern: RegExp; packageName: string; allowTypeOnly: boolean }[] = [
  { pattern: /from\s+['"]stripe['"]/, packageName: 'stripe', allowTypeOnly: true },
  { pattern: /from\s+['"]resend['"]/, packageName: 'resend', allowTypeOnly: false },
  {
    pattern: /from\s+['"]@aws-sdk\/client-s3['"]/,
    packageName: '@aws-sdk/client-s3',
    allowTypeOnly: false,
  },
];

const SCAN_SKIP_PATH_SEGMENTS = ['__tests__', 'tests', 'scripts'] as const;

function collectTypeScriptFiles(directory: string, files: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const relativePath = relative(ROOT, fullPath);
    if (SCAN_SKIP_PATH_SEGMENTS.some((segment) => relativePath.split('/').includes(segment))) {
      continue;
    }
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      collectTypeScriptFiles(fullPath, files);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(relativePath);
    }
  }
  return files;
}

function hasRuntimeSdkImport(content: string, pattern: RegExp, allowTypeOnly: boolean): boolean {
  const lines = content.split('\n');
  for (const line of lines) {
    if (!pattern.test(line)) continue;
    if (allowTypeOnly && /import\s+type\s+/.test(line)) continue;
    return true;
  }
  return false;
}

describe('External SDK coverage (circuit breaker audit)', () => {
  it('should restrict runtime stripe, resend, and S3 SDK imports to infrastructure wrappers', () => {
    const violations: string[] = [];
    const allowlistSet = new Set<string>(EXTERNAL_SDK_ALLOWLIST);

    for (const relativePath of collectTypeScriptFiles(SRC_DIR)) {
      if (allowlistSet.has(relativePath)) continue;

      const content = readFileSync(join(ROOT, relativePath), 'utf-8');
      for (const { pattern, packageName, allowTypeOnly } of SDK_IMPORT_PATTERNS) {
        if (hasRuntimeSdkImport(content, pattern, allowTypeOnly)) {
          violations.push(`${relativePath}: runtime import from "${packageName}"`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('should wrap outbound calls in circuit breakers inside allowlisted SDK modules', () => {
    const circuitByFile: Record<(typeof EXTERNAL_SDK_ALLOWLIST)[number], string> = {
      'src/infrastructure/payment/stripe.client.ts': 'stripeCircuit',
      'src/infrastructure/mail/mail.service.ts': 'resendCircuit',
      'src/infrastructure/storage/s3-adapter.ts': 's3Circuit',
      'src/infrastructure/storage/storage.service.ts': 's3Circuit',
    };

    for (const relativePath of EXTERNAL_SDK_ALLOWLIST) {
      const content = readFileSync(join(ROOT, relativePath), 'utf-8');
      const circuitName = circuitByFile[relativePath];
      expect(content, `${relativePath} must import ${circuitName}`).toContain(circuitName);
      expect(content, `${relativePath} must use circuit.execute()`).toMatch(/\.execute\s*\(/);
    }
  });
});
