/**
 * Parses the optional `-- migration-transaction: none reason="..."` header that
 * opts a migration file out of the default single-transaction execution lane.
 *
 * The migration runner wraps each file in `sql.begin(...)` by default, which is
 * the safe choice for DML and most DDL (atomic apply, automatic rollback on a
 * mid-file error). A small class of statements — most importantly
 * `CREATE INDEX CONCURRENTLY` — *cannot* run inside a transaction. Marking a
 * migration as `none` tells the runner to execute its statements directly,
 * outside any transaction, so concurrent index builds avoid the write-blocking
 * `SHARE` lock that plain `CREATE INDEX` takes on high-write tables.
 *
 * The header is intentionally narrow: only `none` is accepted, a non-empty
 * `reason="..."` is mandatory (so the trade-off is documented next to the SQL),
 * and only the first 20 lines are scanned (mirrors `migration-safety`).
 */

const MIGRATION_HEADER_LINE_LIMIT = 20;

const migrationTransactionHeaderPattern =
  /^--\s+migration-transaction:\s+([a-z]+)\s+reason="([^"]*)"\s*$/i;

const bareMigrationTransactionPattern = /^--\s+migration-transaction:\s*$/i;
const malformedMigrationTransactionPattern = /^--\s+migration-transaction:\s+(?!none\s+reason=)/i;

/**
 * Whether the runner should execute a migration inside a single transaction
 * (`transactional: true`, the default) or statement-by-statement outside any
 * transaction (`transactional: false`, opted in via the header).
 */
export interface MigrationExecutionMode {
  transactional: boolean;
  reason: string | null;
  headerErrors: string[];
}

/**
 * Reads the execution-mode header from a migration file's contents.
 *
 * @remarks
 * Algorithm: scan the first {@link MIGRATION_HEADER_LINE_LIMIT} lines for a
 * `-- migration-transaction: none reason="..."` comment. Absent header →
 * `{ transactional: true }`. A bare or malformed header (anything other than
 * `none reason="..."`, or an empty reason) is reported in `headerErrors` and
 * the file is treated as transactional so the linter — not the runner — is the
 * one that fails the build.
 *
 * Failure modes: none (pure string parsing; never throws).
 *
 * Side effects: none.
 */
export function parseMigrationExecutionMode(fileContent: string): MigrationExecutionMode {
  const headerErrors: string[] = [];
  const lines = fileContent.split('\n');
  const headerLineCount = Math.min(MIGRATION_HEADER_LINE_LIMIT, lines.length);

  let transactional = true;
  let reason: string | null = null;

  for (let lineIndex = 0; lineIndex < headerLineCount; lineIndex += 1) {
    const result = parseMigrationHeaderLine((lines[lineIndex] ?? '').trim(), lineIndex + 1);
    if (result.kind === 'error') {
      headerErrors.push(result.error);
    } else if (result.kind === 'directive') {
      transactional = false;
      reason = result.reason;
    }
  }

  return { transactional, reason, headerErrors };
}

type MigrationHeaderLineResult =
  | { kind: 'skip' }
  | { kind: 'error'; error: string }
  | { kind: 'directive'; reason: string };

/** Classifies one trimmed migration header line as skip / error / a valid `none` directive. */
function parseMigrationHeaderLine(trimmed: string, lineNumber: number): MigrationHeaderLineResult {
  if (!trimmed.startsWith('--')) return { kind: 'skip' };
  if (!trimmed.toLowerCase().includes('migration-transaction:')) return { kind: 'skip' };

  if (bareMigrationTransactionPattern.test(trimmed)) {
    return {
      kind: 'error',
      error: `Line ${lineNumber}: bare "migration-transaction" comment is not allowed; use "-- migration-transaction: none reason=\\"...\\""`,
    };
  }

  const match = migrationTransactionHeaderPattern.exec(trimmed);
  if (!match) {
    if (malformedMigrationTransactionPattern.test(trimmed)) {
      return {
        kind: 'error',
        error: `Line ${lineNumber}: only "none reason=\\"...\\"" is a valid migration-transaction header`,
      };
    }
    return { kind: 'skip' };
  }

  const mode = match[1]?.toLowerCase() ?? '';
  const parsedReason = match[2]?.trim() ?? '';
  if (mode !== 'none') {
    return {
      kind: 'error',
      error: `Line ${lineNumber}: unknown migration-transaction mode "${mode}". Only "none" is supported.`,
    };
  }
  if (parsedReason.length === 0) {
    return {
      kind: 'error',
      error: `Line ${lineNumber}: migration-transaction header requires a non-empty reason`,
    };
  }

  return { kind: 'directive', reason: parsedReason };
}
