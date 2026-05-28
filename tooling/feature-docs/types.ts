/**
 * Shared types for the feature-docs generator.
 *
 * The generator pipeline produces a {@link DocumentedFolder} per discovered
 * directory under `src/`, then renders one {@link RenderedDocument} per folder
 * plus a single index document at `src/DOCS.md`.
 */

export type FolderRole =
  | 'system-root'
  | 'domain'
  | 'sub-domain'
  | 'nested-sub-domain'
  | 'infrastructure-module'
  | 'shared-module'
  | 'scripts-area'
  | 'core-area'
  | 'tests-suite'
  | 'generic';

export type OverviewVariant =
  | 'A.1-domain'
  | 'A.2-sub-domain'
  | 'A.3-infra-shared'
  | 'A.4-test-suite';

export type FileRole =
  | 'routes'
  | 'controller'
  | 'service'
  | 'repository'
  | 'worker'
  | 'processor'
  | 'queue'
  | 'event'
  | 'schema'
  | 'dto'
  | 'validator'
  | 'serializer'
  | 'types'
  | 'container'
  | 'middleware'
  | 'util'
  | 'context'
  | 'client'
  | 'config'
  | 'constants'
  | 'error'
  | 'policy'
  | 'plugin'
  | 'index'
  | 'seed'
  | 'script'
  | 'test'
  | 'other';

export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'const' | 'let' | 'var' | 'type' | 'interface' | 'enum' | 'unknown';
  summary: string | null;
  remarks: string | null;
  isPublic: boolean;
  isInternal: boolean;
  parserErrors: string[];
}

export interface DocumentedFile {
  absolutePath: string;
  relativePath: string;
  fileName: string;
  role: FileRole;
  isServiceLike: boolean;
  isPolicyLike: boolean;
  exports: ExportedSymbol[];
}

export interface RouteEntry {
  method: string;
  fullPath: string;
  access: string;
  summary: string | null;
  description: string | null;
  source: 'zod-schema' | 'unknown';
}

export interface OverviewSection {
  heading: string;
  bodyMarkdown: string;
}

export interface OverviewDocument {
  absolutePath: string;
  variant: OverviewVariant;
  firstLinePath: string | null;
  sections: OverviewSection[];
  missingRequiredSections: string[];
  purposeFirstParagraph: string | null;
}

export interface DocumentedFolder {
  absolutePath: string;
  relativePath: string;
  pathLabel: string;
  role: FolderRole;
  parentRelativePath: string | null;
  childRelativePaths: string[];
  files: DocumentedFile[];
  routes: RouteEntry[];
  overview: OverviewDocument | null;
  overviewVariant: OverviewVariant | null;
  overviewExpected: boolean;
}

export interface SystemFileDocument {
  absolutePath: string;
  filename: 'OVERVIEW.md' | 'PATTERNS.md' | 'FLOWS.md' | 'POLICIES.md';
  exists: boolean;
  firstLinePath: string | null;
  topLevelHeadings: string[];
  missingRequiredSections: string[];
}

export interface SystemDocuments {
  overview: SystemFileDocument;
  patterns: SystemFileDocument;
  flows: SystemFileDocument;
  policies: SystemFileDocument;
}

export interface RenderedDocument {
  absolutePath: string;
  contents: string;
}

export interface GeneratorReport {
  documentsWritten: number;
  documentsUnchanged: number;
  documentedFolders: number;
  routesCatalogged: number;
  exportsCatalogged: number;
  missingTokenCounts: Record<string, number>;
}
