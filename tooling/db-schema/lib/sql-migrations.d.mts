export interface ColumnRef {
  tableVar?: string;
  table: string;
  column: string;
  onDelete: string | null;
}

export interface Column {
  key: string;
  name: string;
  type: string;
  isEnum?: boolean;
  enumName?: string | null;
  enumValues?: string[] | null;
  pk: boolean;
  notNull: boolean;
  unique: boolean;
  array?: boolean;
  default: string | null;
  references: ColumnRef | null;
  length?: number;
  withTimezone?: boolean;
  status?: string;
  changes?: string[];
  delta?: Record<string, unknown>;
}

export interface Table {
  var: string;
  name: string;
  schema: string | null;
  dialect?: string;
  columns: Column[];
  indexes: Array<{ name: string; unique: boolean; columns: string[] }>;
  status?: string;
}

export interface SchemaSnapshot {
  dialect: string;
  enums: Array<{ name: string; values: string[] }>;
  tables: Table[];
  relations: Array<{
    from: string;
    fromColumn: string;
    fromKey?: string;
    to: string;
    toColumn: string;
    onDelete?: string | null;
  }>;
}

export interface MigrationVersion {
  id: number;
  at: string;
  reason: string;
  file: string;
  kind: string;
  structural: boolean;
  skipped?: number;
  schema: SchemaSnapshot;
}

export function emptySchema(): SchemaSnapshot;
export function cloneSchema(schema: SchemaSnapshot | null | undefined): SchemaSnapshot;
export function buildMigrationVersions(migrationsDir: string): {
  versions: MigrationVersion[];
  unreadFiles: number;
};
export function listMigrationFiles(dir: string): string[];
export function applyMigrationSql(
  schema: SchemaSnapshot,
  sql: string,
): { schema: SchemaSnapshot; structural: boolean; skipped: number };
export function parseMigrationFilename(filePath: string): {
  slug: string;
  at: string;
  file: string;
};
export function findTable(
  schema: SchemaSnapshot,
  q: string | { schema: string | null; name: string },
): Table | null;
export function parseColumnDef(line: string): Column | null;
export function parseQualifiedName(raw: string): { schema: string | null; name: string };
export function applyStatement(
  schema: SchemaSnapshot,
  stmt: string,
): 'applied' | 'ignored' | 'unhandled';
export function splitStatements(src: string): string[];
export function stripSqlComments(src: string): string;
