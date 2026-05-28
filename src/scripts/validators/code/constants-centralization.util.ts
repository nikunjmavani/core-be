/**
 * Detects numeric literals reused across multiple source files outside `src/shared/constants/`.
 * Shared constants must be the single source of truth for cross-file magic numbers.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

function getSourceRoot(): string {
  return join(process.cwd(), 'src');
}

function getConstantsRoot(): string {
  return join(getSourceRoot(), 'shared', 'constants');
}

/** Values that legitimately repeat (HTTP status, radix, time bases, byte units). */
const ALLOWED_DUPLICATE_NUMBERS = new Set([
  10, // parseInt radix, deciles
  16, // hex
  24, // hours per day (non-TTL context)
  60, // seconds per minute in expressions
  100, // percentages, env defaults
  200,
  201,
  204,
  300,
  304,
  400,
  401,
  403,
  404,
  409,
  410,
  422,
  429,
  500,
  503,
  1000, // Date ms conversion
  1024, // byte math
]);

function getScanRoots(): readonly string[] {
  const sourceRoot = getSourceRoot();
  return [
    join(sourceRoot, 'domains'),
    join(sourceRoot, 'infrastructure'),
    join(sourceRoot, 'shared'),
    join(sourceRoot, 'core'),
  ];
}

const SKIP_PATH_SEGMENTS = [
  '/__tests__/',
  '/shared/constants/',
  '.schema.ts',
  '.dto.ts',
  '.seed.ts',
  '/scripts/',
  '/tests/',
] as const;

/** A single source location where a duplicated numeric literal was assigned at module scope. */
export interface DuplicateLiteralOccurrence {
  readonly file: string;
  readonly line: number;
  readonly snippet: string;
}

/**
 * One numeric value found at module-level `const` assignments in two or more
 * files outside `src/shared/constants/`. Reported by
 * {@link findDuplicateLiteralViolations}.
 */
export interface DuplicateLiteralViolation {
  readonly value: number;
  readonly occurrences: readonly DuplicateLiteralOccurrence[];
}

function shouldSkipFile(relativePath: string): boolean {
  if (!relativePath.endsWith('.ts')) return true;
  return SKIP_PATH_SEGMENTS.some((segment) => relativePath.includes(segment));
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function evaluateNumericExpression(expression: string): number | undefined {
  const trimmed = expression.trim();
  if (!/^[\d\s_*+().]+$/.test(trimmed)) {
    return undefined;
  }
  try {
    // Evaluates a strictly validated numeric expression (digits, whitespace, `_`, `*+().`) in a
    // repository validator — never attacker-controlled input. The regex above is the security
    // boundary; do not relax it without revisiting this call site.
    const numericExpressionEvaluator = new Function(`return (${trimmed});`);
    const result = numericExpressionEvaluator() as unknown;
    return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

// eslint-disable-next-line security/detect-unsafe-regex -- anchored single-line source scan in a local validator.
const MODULE_LEVEL_CONST_PATTERN = /^(?:export\s+)?const\s+\w+\s*=\s*([^;]+);/;

function isLikelyMagicNumberAssignment(trimmedLine: string, rightHandSide: string): boolean {
  if (trimmedLine.includes('`')) return false;
  if (rightHandSide.includes('/') || rightHandSide.includes('RegExp')) return false;
  if (rightHandSide.includes('(') || rightHandSide.includes('?')) return false;
  if (rightHandSide.includes('[') || rightHandSide.includes('match')) return false;
  if (rightHandSide.includes('z.')) return false;
  return true;
}

function collectNumericLiterals(
  source: string,
): Array<{ value: number; line: number; snippet: string }> {
  const withoutComments = stripComments(source);
  const lines = withoutComments.split('\n');
  const results: Array<{ value: number; line: number; snippet: string }> = [];

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex] ?? '';
    const trimmed = line.trim();
    if (trimmed.startsWith('import ')) continue;

    const constMatch = MODULE_LEVEL_CONST_PATTERN.exec(trimmed);
    if (!constMatch) continue;

    const rightHandSide = constMatch[1]?.trim() ?? '';
    if (!isLikelyMagicNumberAssignment(trimmed, rightHandSide)) continue;

    const value = evaluateNumericExpression(rightHandSide.replaceAll('_', ''));
    if (value === undefined || value <= 1) continue;
    if (!Number.isInteger(value)) continue;

    results.push({
      value,
      line: lineIndex + 1,
      snippet: trimmed.slice(0, 120),
    });
  }

  return results;
}

function walkDirectory(
  directory: string,
  occurrencesByValue: Map<number, DuplicateLiteralOccurrence[]>,
): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(fullPath, occurrencesByValue);
      continue;
    }

    const relativePath = relative(process.cwd(), fullPath).replaceAll('\\', '/');
    if (shouldSkipFile(relativePath)) continue;

    const source = readFileSync(fullPath, 'utf8');
    for (const { value, line, snippet } of collectNumericLiterals(source)) {
      const bucket = occurrencesByValue.get(value) ?? [];
      bucket.push({ file: relativePath, line, snippet });
      occurrencesByValue.set(value, bucket);
    }
  }
}

/** Loads canonical numeric values declared in `src/shared/constants/`. */
export function loadCanonicalConstantValues(): Set<number> {
  const values = new Set<number>();

  function walkConstants(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const fullPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        walkConstants(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;

      const source = readFileSync(fullPath, 'utf8');
      const exportPattern = /export\s+const\s+\w+\s*=\s*([^;]+);/g;
      for (const match of source.matchAll(exportPattern)) {
        const expression = match[1]?.trim();
        if (!expression) continue;
        if (expression.startsWith('{') || expression.startsWith('[')) continue;
        if (expression.includes('as const')) continue;

        const value = evaluateNumericExpression(expression);
        if (value !== undefined && value > 1) {
          values.add(value);
        }
      }
    }
  }

  walkConstants(getConstantsRoot());
  return values;
}

/**
 * Walks the `domains/`, `infrastructure/`, `shared/`, and `core/` source roots
 * and returns numeric literals declared at module scope in two or more files,
 * excluding values listed in {@link ALLOWED_DUPLICATE_NUMBERS} or already
 * exported from `src/shared/constants/`. Used by the constants-centralization
 * lint script to enforce a single source of truth for cross-file magic numbers.
 */
export function findDuplicateLiteralViolations(): DuplicateLiteralViolation[] {
  const occurrencesByValue = new Map<number, DuplicateLiteralOccurrence[]>();

  for (const root of getScanRoots()) {
    walkDirectory(root, occurrencesByValue);
  }

  const canonicalValues = loadCanonicalConstantValues();
  const violations: DuplicateLiteralViolation[] = [];

  for (const [value, occurrences] of occurrencesByValue) {
    if (ALLOWED_DUPLICATE_NUMBERS.has(value)) continue;
    if (canonicalValues.has(value)) continue;

    const files = new Set(occurrences.map((occurrence) => occurrence.file));
    if (files.size < 2) continue;

    violations.push({
      value,
      occurrences: [...occurrences].sort((left, right) =>
        left.file === right.file ? left.line - right.line : left.file.localeCompare(right.file),
      ),
    });
  }

  return violations.sort((left, right) => left.value - right.value);
}
