import type { SchemaSnapshot } from './sql-migrations.d.mts';

export interface DiffResult {
  tables: SchemaSnapshot['tables'];
  relations: SchemaSnapshot['relations'];
  enums: SchemaSnapshot['enums'];
  dialect: string;
  changelog: Array<{
    kind: string;
    table?: string;
    column?: string;
    enum?: string;
    detail?: string;
    values?: string[];
    added?: string[];
    removed?: string[];
  }>;
  counts: {
    tablesAdded: number;
    tablesRemoved: number;
    columnsAdded: number;
    columnsRemoved: number;
    columnsModified: number;
    enumsChanged: number;
  };
  note?: string;
}

export function diffSchemas(
  oldSchema: SchemaSnapshot | null | undefined,
  newSchema: SchemaSnapshot,
): DiffResult;
export function describeColumn(c: unknown): string;
export function colSignature(c: unknown): string;
