import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const SOURCE_ROOT = join(ROOT, 'src');

/**
 * Paths (relative to repo root) allowed to perform direct outbound network calls.
 * Add entries only with review — prefer routing through `src/infrastructure/outbound/`.
 */
const OUTBOUND_BYPASS_ALLOWLIST = [
  'src/infrastructure/outbound/',
  'src/infrastructure/payment/stripe.client.ts',
  'src/infrastructure/mail/mail.service.ts',
  'src/infrastructure/storage/storage.service.ts',
  'src/infrastructure/storage/s3-adapter.ts',
  'src/shared/utils/security/webhook-outbound-fetch.util.ts',
  'src/shared/utils/security/turnstile-verifier.util.ts',
  'src/scripts/',
  'src/tests/',
  'src/infrastructure/observability/',
] as const;

const OUTBOUND_CALL_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\bfetch\s*\(/, label: 'fetch(' },
  { pattern: /\bnew\s+Stripe\s*\(/, label: 'new Stripe(' },
  { pattern: /\bnew\s+Resend\s*\(/, label: 'new Resend(' },
  { pattern: /\bnew\s+S3Client\s*\(/, label: 'new S3Client(' },
  { pattern: /\bhttps?\.request\s*\(/, label: 'http(s).request(' },
];

const SCAN_SKIP_PATH_SEGMENTS = ['node_modules'] as const;

function isAllowlisted(relativePath: string): boolean {
  return OUTBOUND_BYPASS_ALLOWLIST.some((allowed) => {
    if (allowed.endsWith('/')) {
      return relativePath.startsWith(allowed) || relativePath.includes(`/${allowed}`);
    }
    return relativePath === allowed;
  });
}

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

function findViolations(content: string, relativePath: string): string[] {
  const violations: string[] = [];
  const lines = content.split('\n');
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex] ?? '';
    if (line.trimStart().startsWith('//')) continue;
    if (line.includes('import type ')) continue;
    for (const { pattern, label } of OUTBOUND_CALL_PATTERNS) {
      if (pattern.test(line)) {
        violations.push(`${relativePath}:${lineIndex + 1}: ${label}`);
      }
    }
  }
  return violations;
}

describe('outbound bypass guard', () => {
  it('should forbid direct outbound network calls outside the allowlist', () => {
    const allViolations: string[] = [];

    for (const relativePath of collectTypeScriptFiles(SOURCE_ROOT)) {
      if (isAllowlisted(relativePath)) continue;
      const content = readFileSync(join(ROOT, relativePath), 'utf-8');
      allViolations.push(...findViolations(content, relativePath));
    }

    expect(allViolations).toEqual([]);
  });
});
