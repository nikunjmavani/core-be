export function tableKey(t: { schema?: string | null; name: string } | string): string;
export function normalizeOnDelete(v: unknown): string | null;
export function normalizeType(t: unknown): unknown;
export function normalizeDefault(d: unknown): string | null;
export function normalizeReferences(ref: unknown): {
  table: string | null;
  column: string | null;
  onDelete: string | null;
} | null;
export function normalizeColumn<T>(c: T): T;
export function normalizeSchema(schema: unknown): {
  dialect: string;
  enums: unknown[];
  tables: unknown[];
  relations: unknown[];
};
