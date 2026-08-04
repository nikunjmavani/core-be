export const DEFAULT_PORT: number;
export const MODULE_DIR: string;

export function resolveProject(opts?: {
  cwd?: string;
  projectRoot?: string;
  schema?: string;
  migrations?: string;
  port?: number;
  name?: string;
}): {
  root: string;
  name: string;
  port: number;
  schemaTarget: string | null;
  migrationsDir: string | null;
  configPath: string | null;
  configError: string | null;
  source: string;
};

export function findProjectRoot(start?: string): string;
export function hasSqlMigrations(dir: string): boolean;
export function hasSchemaFiles(dir: string): boolean;
export function detectMigrations(root: string, schemaTarget: string): string | null;
export function detectSchema(root: string): string | null;
