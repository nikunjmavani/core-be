/**
 * Flags user-facing English fallback strings on throws that already use a translation messageKey.
 * Usage: part of pnpm validate:locale-keys
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC_ROOT = join(process.cwd(), 'src');

/** Paths excluded from fallback audit (tests may use explicit fallbacks). */
const EXCLUDED_PATH_PATTERNS = [
  /\/__tests__\//,
  /\/tests\//,
  /\.test\.ts$/,
  /\.unit\.test\.ts$/,
  /\.integration\.test\.ts$/,
  /\.e2e\.test\.ts$/,
];

const MESSAGE_KEY_PREFIX = /^(errors|success|common|mail):/;

/** Matches `, undefined, 'English fallback'` or `, { ... }, 'English fallback'` after an errors: messageKey. */
const REDUNDANT_FALLBACK_PATTERN =
  /(['"]errors:[^'"]+['"][\s\S]*?),\s*(?:undefined|\{[^}]*\}),\s*['"]([^'"]+)['"]/g;

/** AppError(messageCode, statusCode, messageKey, …) — messageKey is the third string literal. */
const RAW_APP_ERROR_MESSAGE_KEY_PATTERN =
  /throw new AppError\(\s*['"][^'"]+['"]\s*,\s*\d+\s*,\s*['"](?!errors:|success:|common:|mail:)([^'"]+)['"]/g;

/** Subclasses use messageKey as the first string literal. */
const RAW_SUBCLASS_MESSAGE_KEY_PATTERN =
  /throw new (?:UnauthorizedError|ForbiddenError|ValidationError|ConflictError|NotImplementedError|RateLimitedError|PayloadTooLargeError|UnprocessableEntityError|ServiceUnavailableError|GoneError)\(\s*['"](?!errors:|success:|common:|mail:)([^'"]+)['"]/g;

/** NotFoundError first argument is a resource label for errors:notFound interpolation, not a messageKey. */
const NOT_FOUND_RESOURCE_PATTERN = /^[A-Za-z][A-Za-z0-9 /_-]{0,80}$/;

export type HardcodedFallbackViolation = {
  file: string;
  line: number;
  kind: 'redundant_fallback' | 'raw_message_key';
  detail: string;
};

function isExcluded(filePath: string): boolean {
  return EXCLUDED_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

function collectTypeScriptFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectTypeScriptFiles(absolutePath, collected);
    } else if (entry.name.endsWith('.ts')) {
      collected.push(absolutePath);
    }
  }
  return collected;
}

export function findHardcodedFallbackViolations(): HardcodedFallbackViolation[] {
  const violations: HardcodedFallbackViolation[] = [];
  const files = collectTypeScriptFiles(SRC_ROOT);

  for (const absolutePath of files) {
    const relativePath = relative(process.cwd(), absolutePath);
    if (isExcluded(relativePath)) continue;

    const content = readFileSync(absolutePath, 'utf-8');

    for (const pattern of [RAW_APP_ERROR_MESSAGE_KEY_PATTERN, RAW_SUBCLASS_MESSAGE_KEY_PATTERN]) {
      for (const match of content.matchAll(pattern)) {
        const messageKey = match[1];
        if (!messageKey) continue;
        violations.push({
          file: relativePath,
          line: lineNumberAt(content, match.index ?? 0),
          kind: 'raw_message_key',
          detail: `messageKey must use errors:/success:/common:/mail: namespace, got "${messageKey}"`,
        });
      }
    }

    for (const match of content.matchAll(/throw new NotFoundError\(\s*['"]([^'"]+)['"]/g)) {
      const resource = match[1];
      if (!resource || NOT_FOUND_RESOURCE_PATTERN.test(resource)) continue;
      violations.push({
        file: relativePath,
        line: lineNumberAt(content, match.index ?? 0),
        kind: 'raw_message_key',
        detail: `NotFoundError resource looks like a sentence; add an errors: key instead of "${resource}"`,
      });
    }

    REDUNDANT_FALLBACK_PATTERN.lastIndex = 0;
    for (const match of content.matchAll(REDUNDANT_FALLBACK_PATTERN)) {
      const matchIndex = match.index ?? 0;
      const contextBefore = content.slice(Math.max(0, matchIndex - 400), matchIndex);
      if (contextBefore.includes('translateDetail(')) continue;

      const fallback = match[2];
      if (!fallback || MESSAGE_KEY_PREFIX.test(fallback)) continue;
      violations.push({
        file: relativePath,
        line: lineNumberAt(content, matchIndex),
        kind: 'redundant_fallback',
        detail: `remove hardcoded fallback "${fallback}"; use messageKey + request.t() only`,
      });
    }
  }

  return violations;
}

function main(): void {
  const violations = findHardcodedFallbackViolations();

  if (violations.length === 0) {
    console.log('✅ validate-locale-hardcoded-fallbacks passed');
    return;
  }

  console.error('\n❌ Hardcoded user-facing error fallbacks:\n');
  for (const violation of violations) {
    console.error(`  ${violation.file}:${violation.line} [${violation.kind}] ${violation.detail}`);
  }
  console.error(
    '\nRule: throw with messageKey only; error handler translates via request.t(messageKey).',
  );
  process.exit(1);
}

if (import.meta.url === new URL(process.argv[1] ?? '', 'file:').href) {
  main();
}
