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
  'src/infrastructure/outbound/',
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

  it('should route SDK outbound calls through outboundCall in infrastructure wrappers', () => {
    const sdkWrapperFiles = [
      'src/infrastructure/payment/stripe.client.ts',
      'src/infrastructure/mail/mail.service.ts',
      'src/infrastructure/storage/s3-adapter.ts',
      'src/infrastructure/storage/storage.service.ts',
    ] as const;

    for (const relativePath of sdkWrapperFiles) {
      const content = readFileSync(join(ROOT, relativePath), 'utf-8');
      expect(content, `${relativePath} must use outboundCall`).toContain('outboundCall');
    }
  });

  // P0-#3 regression: a worker (`*.worker.ts` or `*.processor.ts`) that imports
  // `node:http` / `node:https` directly skips the central `outboundCall` AbortSignal
  // plumbing — meaning a BullMQ stall-timeout cannot cancel its outbound I/O and the
  // job's side effect can execute twice when a second worker picks the stalled job
  // back up. Force every worker through the wrappers so the signal is threaded by
  // construction.
  it('should not allow workers/processors to import node:http or node:https (must use outboundCall via wrapper)', () => {
    const workerNodeHttpAllowlist = new Set<string>([
      // The webhook delivery worker uses node:http/https indirectly via the pinned-fetch
      // util (src/shared/utils/security/webhook-outbound-fetch.util.ts), NOT directly,
      // so this allowlist is currently empty. Adding an entry is a maintainer decision
      // and must be justified in PR review.
    ]);

    const violations: string[] = [];
    for (const relativePath of collectTypeScriptFiles(SRC_DIR)) {
      if (!(relativePath.endsWith('.worker.ts') || relativePath.endsWith('.processor.ts'))) {
        continue;
      }
      if (workerNodeHttpAllowlist.has(relativePath)) continue;
      const content = readFileSync(join(ROOT, relativePath), 'utf-8');
      if (/from\s+['"]node:https?['"]/.test(content)) {
        violations.push(`${relativePath}: direct node:http(s) import`);
      }
      if (/from\s+['"]undici['"]/.test(content)) {
        violations.push(`${relativePath}: direct undici import`);
      }
    }
    expect(violations).toEqual([]);
  });
});
