/**
 * Policy: a table cannot exist without a FORCE-RLS decision.
 *
 * `EXPECTED_FORCE_RLS_TABLES` is the intentional FORCE-RLS set; the DB-bound
 * suite (`src/tests/security/rls/rls-matrix.security.test.ts`) asserts the LIVE
 * database matches it. That leaves a static gap: a brand-new Drizzle table
 * added to a `*.schema.ts` without touching the constant (and without an RLS
 * migration) only fails once the DB-bound security lane runs — and reads as an
 * RLS-suite failure, not as "you forgot RLS on your new table".
 *
 * This offline test closes the loop at the static tier: the set of tables
 * DECLARED across every `*.schema.ts` must equal `EXPECTED_FORCE_RLS_TABLES`
 * exactly (schema-qualified, resolved through `pg-schemas.ts`). A table that
 * must NOT be force-RLS is a deliberate exception — list it in
 * `NON_FORCE_RLS_TABLE_EXEMPTIONS` with a justification.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  EXPECTED_FORCE_RLS_TABLES,
  forceRlsTableKey,
} from '@/infrastructure/database/utils/force-rls-tables.constants.js';

const PROJECT_ROOT = process.cwd();
const SOURCE_ROOT = join(PROJECT_ROOT, 'src');
const PG_SCHEMAS_PATH = join(PROJECT_ROOT, 'src/infrastructure/database/pg-schemas.ts');

/**
 * Declared tables that intentionally do NOT carry FORCE ROW LEVEL SECURITY.
 * Empty today — every table in the codebase is force-RLS. Adding an entry here
 * must be a deliberate, reviewed decision paired with a comment saying why.
 */
const NON_FORCE_RLS_TABLE_EXEMPTIONS = new Set<string>([]);

/** Parses `export const authSchema = pgSchema('auth')` → { authSchema: 'auth', … }. */
function parsePgSchemaIdentifiers(): Map<string, string> {
  const source = readFileSync(PG_SCHEMAS_PATH, 'utf8');
  const identifiers = new Map<string, string>();
  for (const match of source.matchAll(/export const (\w+) = pgSchema\('(\w+)'\)/g)) {
    const [, identifier, schemaName] = match;
    if (identifier === undefined || schemaName === undefined) continue;
    identifiers.set(identifier, schemaName);
  }
  return identifiers;
}

function collectSchemaFiles(directory: string, accumulator: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === '__tests__' || entry === 'node_modules') continue;
      collectSchemaFiles(fullPath, accumulator);
      continue;
    }
    if (entry.endsWith('.schema.ts')) accumulator.push(relative(PROJECT_ROOT, fullPath));
  }
  return accumulator;
}

describe('Global: schema ↔ FORCE-RLS parity', () => {
  const schemaIdentifiers = parsePgSchemaIdentifiers();
  const schemaFiles = collectSchemaFiles(SOURCE_ROOT);

  /** `<schema>.<table>` for every table declared in any *.schema.ts. */
  const declaredTables = new Map<string, string>();
  const unresolvedDeclarations: string[] = [];
  for (const filePath of schemaFiles) {
    const source = readFileSync(join(PROJECT_ROOT, filePath), 'utf8');
    // `\s*` before `.table` covers the chained multi-line form:
    // `export const uploads = uploadSchema\n  .table(\n    'uploads', …`.
    for (const match of source.matchAll(/(\w+)\s*\.table\(\s*'([a-z_]+)'/g)) {
      const [, identifier, tableName] = match;
      if (identifier === undefined || tableName === undefined) continue;
      const schemaName = schemaIdentifiers.get(identifier);
      if (schemaName === undefined) {
        unresolvedDeclarations.push(`${filePath} → ${identifier}.table('${tableName}')`);
        continue;
      }
      declaredTables.set(forceRlsTableKey(schemaName, tableName), filePath);
    }
  }

  it('finds pg schemas and declared tables', () => {
    expect(schemaIdentifiers.size).toBeGreaterThanOrEqual(6);
    expect(declaredTables.size).toBeGreaterThanOrEqual(30);
  });

  it('every table declaration resolves to a shared pgSchema from pg-schemas.ts', () => {
    expect(
      unresolvedDeclarations,
      'Table declared through an identifier not exported by pg-schemas.ts — use the shared ' +
        'pgSchema definitions so the RLS parity scan (and RLS itself) can see the table.',
    ).toEqual([]);
  });

  it('every declared table is in EXPECTED_FORCE_RLS_TABLES (or a reviewed exemption)', () => {
    const expectedKeys = new Set(
      EXPECTED_FORCE_RLS_TABLES.map((table) => forceRlsTableKey(table.schemaName, table.tableName)),
    );
    const missing = [...declaredTables.entries()]
      .filter(([key]) => !(expectedKeys.has(key) || NON_FORCE_RLS_TABLE_EXEMPTIONS.has(key)))
      .map(([key, filePath]) => `${key} (declared in ${filePath})`);
    expect(
      missing,
      'Table declared without a FORCE-RLS decision. Add it to EXPECTED_FORCE_RLS_TABLES ' +
        'plus an ENABLE/FORCE ROW LEVEL SECURITY migration, or (deliberately non-RLS tables) ' +
        'to NON_FORCE_RLS_TABLE_EXEMPTIONS with a justification.',
    ).toEqual([]);
  });

  it('every EXPECTED_FORCE_RLS_TABLES entry maps to a declared table (no stale entries)', () => {
    const stale = EXPECTED_FORCE_RLS_TABLES.map((table) =>
      forceRlsTableKey(table.schemaName, table.tableName),
    ).filter((key) => !declaredTables.has(key));
    expect(
      stale,
      'EXPECTED_FORCE_RLS_TABLES names a table no *.schema.ts declares — remove the stale entry.',
    ).toEqual([]);
  });

  it('no table is both expected and exempted', () => {
    const expectedKeys = new Set(
      EXPECTED_FORCE_RLS_TABLES.map((table) => forceRlsTableKey(table.schemaName, table.tableName)),
    );
    const contradictions = [...NON_FORCE_RLS_TABLE_EXEMPTIONS].filter((key) =>
      expectedKeys.has(key),
    );
    expect(contradictions).toEqual([]);
  });
});
