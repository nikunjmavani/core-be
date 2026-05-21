/* eslint-disable security/detect-unsafe-regex -- bounded SQL migration parsing; inputs are repo-controlled files */
/**
 * Generates docs/database/core-be.dbml (dbdiagram.io / DBML) by replaying migrations/*.sql in order.
 *
 * DBML reference: https://dbml.dbdiagram.io/docs
 * Import file at: https://dbdiagram.io/
 *
 * Usage: pnpm tool:generate-dbdiagram
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '../../..');
const MIGRATIONS_DIRECTORY = path.join(REPOSITORY_ROOT, 'migrations');
const OUTPUT_PATH = path.join(REPOSITORY_ROOT, 'docs/database/core-be.dbml');

type ForeignKeyReference = {
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  onDelete?: string;
};

type ColumnDefinition = {
  name: string;
  dbmlType: string;
  primaryKey: boolean;
  notNull: boolean;
  unique: boolean;
  increment: boolean;
};

type TableDefinition = {
  schema: string;
  name: string;
  columns: Map<string, ColumnDefinition>;
  foreignKeys: Array<{ column: string; reference: ForeignKeyReference }>;
  rowLevelSecurityEnabled: boolean;
  rowLevelSecurityPolicies: string[];
  tableNotes: string[];
  partitionedBy?: string;
  compositePrimaryKey?: string[];
};

const tables = new Map<string, TableDefinition>();

function qualifiedTableKey(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function tableDbmlName(schema: string, table: string): string {
  return `${schema}.${table}`;
}

function normalizeSqlType(rawType: string): string {
  const normalized = rawType.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!normalized) return 'text';
  if (normalized.startsWith('bigserial')) return 'bigint';
  if (normalized.startsWith('serial')) return 'int';
  if (normalized.startsWith('varchar') || normalized.startsWith('character varying')) {
    return normalized.includes('(') ? normalized : 'varchar';
  }
  if (normalized === 'timestamptz' || normalized.startsWith('timestamp with time zone')) {
    return 'timestamptz';
  }
  if (normalized.startsWith('timestamp')) return 'timestamp';
  if (normalized.startsWith('decimal') || normalized.startsWith('numeric')) {
    return normalized.includes('(') ? normalized : 'decimal';
  }
  if (normalized === 'bool' || normalized === 'boolean') return 'boolean';
  if (normalized === 'int' || normalized === 'integer') return 'int';
  if (normalized === 'bigint') return 'bigint';
  if (normalized === 'text') return 'text';
  if (normalized === 'jsonb') return 'jsonb';
  if (normalized === 'inet') return 'varchar';
  if (normalized === 'uuid') return 'uuid';
  return normalized.split('(')[0] ?? 'text';
}

function parseForeignKeyReference(line: string): ForeignKeyReference | undefined {
  const match = line.match(
    /references\s+"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s*\(\s*"?([a-z_][a-z0-9_]*)"?\s*\)(?:\s+on\s+delete\s+([a-z\s]+))?/i,
  );
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const reference: ForeignKeyReference = {
    targetSchema: match[1],
    targetTable: match[2],
    targetColumn: match[3],
  };
  const onDelete = match[4]?.trim().toLowerCase();
  if (onDelete) reference.onDelete = onDelete;
  return reference;
}

function parseColumnDefinitionLine(line: string): {
  column: ColumnDefinition;
  foreignKey?: ForeignKeyReference;
} | null {
  let trimmed = line.trim().replace(/,$/, '');
  if (!trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('constraint ') ||
    lower.startsWith('primary key') ||
    lower.startsWith('unique (') ||
    lower.startsWith('check ') ||
    lower === ')' ||
    lower.startsWith('like ')
  ) {
    return null;
  }

  const foreignKey = parseForeignKeyReference(trimmed);
  if (foreignKey) {
    trimmed = trimmed.replace(
      /references\s+"?[a-z_][a-z0-9_]*"?\."?[a-z_][a-z0-9_]*"?\s*\(\s*"?[a-z_][a-z0-9_]*"?\s*\)(?:\s+on\s+delete\s+[a-z\s]+)?/i,
      '',
    );
  }

  const nameMatch = trimmed.match(/^"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i);
  if (!nameMatch?.[1] || !nameMatch[2]) return null;

  const columnName = nameMatch[1];
  let remainder = nameMatch[2].trim();

  const primaryKey = /\bprimary\s+key\b/i.test(remainder);
  const notNull = /\bnot\s+null\b/i.test(remainder);
  const unique = /\bunique\b/i.test(remainder) && !primaryKey;
  const increment = /\bbigserial\b/i.test(remainder) || /\bserial\b/i.test(remainder);

  remainder = remainder
    .replace(/\bprimary\s+key\b/gi, '')
    .replace(/\bnot\s+null\b/gi, '')
    .replace(/\bunique\b/gi, '')
    .replace(/\bdefault\b[\s\S]*$/i, '')
    .trim();

  const typeMatch = remainder.match(/^([a-z]+(?:\([^)]*\))?(?:\s+with\s+time\s+zone)?)/i);
  const dbmlType = normalizeSqlType(typeMatch?.[1] ?? remainder.split(/\s+/)[0] ?? 'text');

  const result: {
    column: ColumnDefinition;
    foreignKey?: ForeignKeyReference;
  } = {
    column: {
      name: columnName,
      dbmlType,
      primaryKey,
      notNull,
      unique,
      increment,
    },
  };
  if (foreignKey) result.foreignKey = foreignKey;
  return result;
}

function getOrCreateTable(schema: string, table: string): TableDefinition {
  const key = qualifiedTableKey(schema, table);
  let existing = tables.get(key);
  if (!existing) {
    existing = {
      schema,
      name: table,
      columns: new Map(),
      foreignKeys: [],
      rowLevelSecurityEnabled: false,
      rowLevelSecurityPolicies: [],
      tableNotes: [],
    };
    tables.set(key, existing);
  }
  return existing;
}

function applyCreateTableBody(schema: string, table: string, body: string): void {
  const tableDefinition = getOrCreateTable(schema, table);
  for (const line of body.split('\n')) {
    const parsed = parseColumnDefinitionLine(line);
    if (!parsed) continue;
    tableDefinition.columns.set(parsed.column.name, parsed.column);
    if (parsed.foreignKey) {
      tableDefinition.foreignKeys.push({
        column: parsed.column.name,
        reference: parsed.foreignKey,
      });
    }
  }
  const partitionMatch = body.match(/partition\s+by\s+range\s*\(\s*([a-z_]+)\s*\)/i);
  if (partitionMatch?.[1]) {
    tableDefinition.partitionedBy = partitionMatch[1];
  }
}

function extractCreateTableStatements(
  sql: string,
): Array<{ schema: string; table: string; body: string }> {
  const results: Array<{ schema: string; table: string; body: string }> = [];
  const pattern =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s*\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(sql)) !== null) {
    const schema = match[1] ?? '';
    const table = match[2] ?? '';
    const openParenthesisIndex = match.index + match[0].length;
    let depth = 1;
    let index = openParenthesisIndex;
    while (index < sql.length && depth > 0) {
      const character = sql[index];
      if (character === '(') depth += 1;
      if (character === ')') depth -= 1;
      index += 1;
    }
    results.push({ schema, table, body: sql.slice(openParenthesisIndex, index - 1) });
  }
  return results;
}

function processMigrationSql(sql: string): void {
  for (const { schema, table, body } of extractCreateTableStatements(sql)) {
    applyCreateTableBody(schema, table, body);
  }

  const dropPattern =
    /drop\s+table\s+(?:if\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?/gi;
  let dropMatch: RegExpExecArray | null;
  while ((dropMatch = dropPattern.exec(sql)) !== null) {
    if (dropMatch[1] && dropMatch[2]) {
      tables.delete(qualifiedTableKey(dropMatch[1], dropMatch[2]));
    }
  }

  const addColumnPattern =
    /alter\s+table\s+"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s+add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\s+([^;]+)/gi;
  let addColumnMatch: RegExpExecArray | null;
  while ((addColumnMatch = addColumnPattern.exec(sql)) !== null) {
    const parsed = parseColumnDefinitionLine(
      `${addColumnMatch[3] ?? ''} ${addColumnMatch[4] ?? ''}`,
    );
    if (!parsed || !addColumnMatch[1] || !addColumnMatch[2]) continue;
    const tableDefinition = getOrCreateTable(addColumnMatch[1], addColumnMatch[2]);
    tableDefinition.columns.set(parsed.column.name, parsed.column);
    if (parsed.foreignKey) {
      tableDefinition.foreignKeys.push({
        column: parsed.column.name,
        reference: parsed.foreignKey,
      });
    }
  }

  const compositePrimaryKeyPattern =
    /alter\s+table\s+"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s+add\s+primary\s+key\s*\(\s*([^)]+)\s*\)/gi;
  let compositePrimaryKeyMatch: RegExpExecArray | null;
  while ((compositePrimaryKeyMatch = compositePrimaryKeyPattern.exec(sql)) !== null) {
    if (
      !compositePrimaryKeyMatch[1] ||
      !compositePrimaryKeyMatch[2] ||
      !compositePrimaryKeyMatch[3]
    ) {
      continue;
    }
    const tableDefinition = getOrCreateTable(
      compositePrimaryKeyMatch[1],
      compositePrimaryKeyMatch[2],
    );
    tableDefinition.compositePrimaryKey = compositePrimaryKeyMatch[3]
      .split(',')
      .map((column) => column.trim().replaceAll('"', ''))
      .filter(Boolean);
  }

  const partitionPattern =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?[\s\S]*?\)\s+partition\s+by\s+range\s*\(\s*"?([a-z_][a-z0-9_]*)"?\s*\)/gi;
  let partitionMatch: RegExpExecArray | null;
  while ((partitionMatch = partitionPattern.exec(sql)) !== null) {
    if (!partitionMatch[1] || !partitionMatch[2] || !partitionMatch[3]) continue;
    getOrCreateTable(partitionMatch[1], partitionMatch[2]).partitionedBy = partitionMatch[3];
  }

  const enableRlsPattern =
    /alter\s+table\s+"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s+enable\s+row\s+level\s+security/gi;
  let enableRlsMatch: RegExpExecArray | null;
  while ((enableRlsMatch = enableRlsPattern.exec(sql)) !== null) {
    if (!enableRlsMatch[1] || !enableRlsMatch[2]) continue;
    getOrCreateTable(enableRlsMatch[1], enableRlsMatch[2]).rowLevelSecurityEnabled = true;
  }

  const forceRlsPattern =
    /alter\s+table\s+"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?\s+force\s+row\s+level\s+security/gi;
  let forceRlsMatch: RegExpExecArray | null;
  while ((forceRlsMatch = forceRlsPattern.exec(sql)) !== null) {
    if (!forceRlsMatch[1] || !forceRlsMatch[2]) continue;
    const tableDefinition = getOrCreateTable(forceRlsMatch[1], forceRlsMatch[2]);
    tableDefinition.rowLevelSecurityEnabled = true;
    if (!tableDefinition.tableNotes.includes('FORCE ROW LEVEL SECURITY')) {
      tableDefinition.tableNotes.push('FORCE ROW LEVEL SECURITY');
    }
  }

  const policyPattern =
    /create\s+policy\s+"?([a-z_][a-z0-9_]*)"?\s+on\s+"?([a-z_][a-z0-9_]*)"?\."?([a-z_][a-z0-9_]*)"?/gi;
  let policyMatch: RegExpExecArray | null;
  while ((policyMatch = policyPattern.exec(sql)) !== null) {
    if (!policyMatch[1] || !policyMatch[2] || !policyMatch[3]) continue;
    const tableDefinition = getOrCreateTable(policyMatch[2], policyMatch[3]);
    if (!tableDefinition.rowLevelSecurityPolicies.includes(policyMatch[1])) {
      tableDefinition.rowLevelSecurityPolicies.push(policyMatch[1]);
    }
    tableDefinition.rowLevelSecurityEnabled = true;
  }

  if (/stripe_webhook_events[\s\S]*no\s+tenant\s+rls/i.test(sql)) {
    const tableDefinition = getOrCreateTable('billing', 'stripe_webhook_events');
    tableDefinition.tableNotes.push('System table — no tenant RLS');
    tableDefinition.rowLevelSecurityEnabled = false;
  }

  if (/mail_outbox[\s\S]*no\s+tenant\s+rls/i.test(sql)) {
    const tableDefinition = getOrCreateTable('auth', 'mail_outbox');
    tableDefinition.tableNotes.push('System table — no tenant RLS');
    tableDefinition.rowLevelSecurityEnabled = false;
  }
}

function columnSettings(column: ColumnDefinition): string {
  const settings: string[] = [];
  if (column.primaryKey) settings.push('pk');
  if (column.increment) settings.push('increment');
  if (column.notNull) settings.push('not null');
  if (column.unique) settings.push('unique');
  return settings.length > 0 ? ` [${settings.join(', ')}]` : '';
}

function renderRelationshipLine(
  sourceSchema: string,
  sourceTable: string,
  sourceColumn: string,
  reference: ForeignKeyReference,
): string {
  const source = `${sourceSchema}.${sourceTable}.${sourceColumn}`;
  const target = `${reference.targetSchema}.${reference.targetTable}.${reference.targetColumn}`;
  const deleteSetting = reference.onDelete ? ` [delete: ${reference.onDelete}]` : '';
  return `Ref: ${source} > ${target}${deleteSetting}`;
}

function renderDbml(): string {
  const schemaNames = [...new Set([...tables.values()].map((table) => table.schema))].sort();
  const lines: string[] = [
    '// Generated by pnpm tool:generate-dbdiagram — do not edit by hand',
    '// Replay of migrations/*.sql in filename order (cumulative schema).',
    '// Import at https://dbdiagram.io (DBML): https://dbml.dbdiagram.io/docs',
    '',
    'Project core_be {',
    "  database_type: 'PostgreSQL'",
    '}',
    '',
  ];

  for (const schemaName of schemaNames) {
    lines.push(`TableGroup ${schemaName} {`);
    for (const table of [...tables.values()]
      .filter((table) => table.schema === schemaName)
      .sort((left, right) => left.name.localeCompare(right.name))) {
      lines.push(`  ${tableDbmlName(table.schema, table.name)}`);
    }
    lines.push('}');
    lines.push('');
  }

  const sortedTables = [...tables.values()].sort((left, right) => {
    const schemaCompare = left.schema.localeCompare(right.schema);
    return schemaCompare !== 0 ? schemaCompare : left.name.localeCompare(right.name);
  });

  for (const table of sortedTables) {
    const tableIdentifier = tableDbmlName(table.schema, table.name);
    lines.push(`Table ${tableIdentifier} {`);

    const columns = [...table.columns.values()].sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    if (columns.length === 0) {
      lines.push("  _unparsed text [note: 'column list not parsed — see migrations']");
    } else {
      for (const column of columns) {
        const columnForRender =
          table.compositePrimaryKey?.includes(column.name) === true
            ? { ...column, primaryKey: false }
            : column;
        lines.push(`  ${column.name} ${column.dbmlType}${columnSettings(columnForRender)}`);
      }
    }

    if (table.compositePrimaryKey && table.compositePrimaryKey.length > 0) {
      lines.push('  indexes {');
      lines.push(`    (${table.compositePrimaryKey.join(', ')}) [pk]`);
      lines.push('  }');
    }

    lines.push('}');
    lines.push('');

    const notes: string[] = [];
    if (table.partitionedBy) {
      notes.push(`Partitioned BY RANGE (${table.partitionedBy})`);
    }
    if (table.rowLevelSecurityEnabled) {
      notes.push('RLS: enabled');
      if (table.rowLevelSecurityPolicies.length > 0) {
        notes.push(`Policies: ${table.rowLevelSecurityPolicies.join(', ')}`);
      }
    } else {
      notes.push('RLS: not enabled');
    }
    notes.push(...table.tableNotes);

    const noteText = notes.join('\\n').replace(/'/g, "\\'");
    lines.push(`Note ${tableIdentifier} {`);
    lines.push(`  '${noteText}'`);
    lines.push('}');
    lines.push('');
  }

  const relationshipLines = new Set<string>();
  for (const table of sortedTables) {
    for (const foreignKey of table.foreignKeys) {
      relationshipLines.add(
        renderRelationshipLine(table.schema, table.name, foreignKey.column, foreignKey.reference),
      );
    }
  }

  for (const relationshipLine of [...relationshipLines].sort()) {
    lines.push(relationshipLine);
  }

  lines.push('');
  return lines.join('\n');
}

async function main(): Promise<void> {
  const migrationFiles = (await readdir(MIGRATIONS_DIRECTORY))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();

  for (const migrationFile of migrationFiles) {
    const sql = await readFile(path.join(MIGRATIONS_DIRECTORY, migrationFile), 'utf8');
    processMigrationSql(sql);
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  const dbml = renderDbml();
  await writeFile(OUTPUT_PATH, dbml, 'utf8');
  console.log(
    `Wrote ${OUTPUT_PATH} (${tables.size} tables from ${migrationFiles.length} migrations)`,
  );
}

void main();
