/**
 * Renders one `DOCS.md` per documented folder following draft Template B.
 *
 * Layout:
 *   1. Backticked path on line 1 (matches Phase 3 hard-gate check).
 *   2. Generated banner.
 *   3. H1 = title from folder name.
 *   4. `## Overview` — first paragraph of `OVERVIEW.md` Purpose section.
 *   5. `## Sub-domains` — only on domain DOCS.md.
 *   6. `## Routes` — Method / Path / Access / Description from Zod schemas.
 *   7. Per-role file sections (Services / Workers / Repositories / ...).
 *      Each exported symbol shows summary inline and a `<details>` panel
 *      with the `@remarks` body when present. Service/worker/processor
 *      exports without `@remarks` produce a `MISSING_REMARKS` token.
 */
import { dirname, join, relative, sep } from 'node:path';
import {
  DOCS_GENERATED_BANNER,
  MISSING_DESCRIPTION_TOKEN,
  MISSING_OVERVIEW_SECTION_TOKEN,
  MISSING_REMARKS_TOKEN,
  PER_FOLDER_DOCS_FILENAME,
  REPO_ROOT,
} from './constants.js';
import { FILE_ROLE_DISPLAY_LABELS, ROLE_RENDER_ORDER } from './file-classifier.js';
import type { DocumentedFile, DocumentedFolder, ExportedSymbol, RouteEntry } from './types.js';

interface RenderInput {
  folder: DocumentedFolder;
  childFoldersByParent: Map<string, DocumentedFolder[]>;
}

export function renderFolderDocs(input: RenderInput): { absolutePath: string; contents: string } {
  const { folder, childFoldersByParent } = input;
  const lines: string[] = [];

  lines.push(`\`${folder.pathLabel}\``);
  lines.push('');
  lines.push(DOCS_GENERATED_BANNER);
  lines.push('');
  lines.push(`# ${humanizeFolderName(folder.relativePath)} — Catalog`);
  lines.push('');

  appendOverviewSection(lines, folder);
  appendSubDomainTable(lines, folder, childFoldersByParent);
  appendRoutesTable(lines, folder.routes);
  appendExportsByRole(lines, folder.files);
  appendOverviewIssues(lines, folder);

  const absolutePath = join(folder.absolutePath, PER_FOLDER_DOCS_FILENAME);
  return { absolutePath, contents: `${lines.join('\n')}\n` };
}

function humanizeFolderName(relativePath: string): string {
  const segments = relativePath.split('/');
  const last = segments[segments.length - 1] ?? '';
  return last
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function appendOverviewSection(lines: string[], folder: DocumentedFolder): void {
  lines.push('## Overview');
  lines.push('');
  if (folder.overview?.purposeFirstParagraph) {
    lines.push(folder.overview.purposeFirstParagraph);
    lines.push('');
    lines.push(`→ Read the full overview: [OVERVIEW.md](./OVERVIEW.md)`);
  } else if (folder.overviewExpected) {
    lines.push(MISSING_DESCRIPTION_TOKEN);
    lines.push('');
    lines.push(
      `Overview missing — author \`${folder.relativePath}/OVERVIEW.md\` (variant ${folder.overviewVariant ?? 'unspecified'}).`,
    );
  } else {
    lines.push(`(No \`OVERVIEW.md\` for this folder.)`);
  }
  lines.push('');
}

function appendSubDomainTable(
  lines: string[],
  folder: DocumentedFolder,
  childFoldersByParent: Map<string, DocumentedFolder[]>,
): void {
  if (folder.role !== 'domain') return;
  const subDomainsRoot = join(folder.absolutePath, 'sub-domains');
  const children = childFoldersByParent.get(subDomainsRoot) ?? [];
  if (children.length === 0) return;

  lines.push('## Sub-domains');
  lines.push('');
  lines.push('| Folder | Purpose |');
  lines.push('| --- | --- |');
  for (const child of children) {
    const folderName = child.relativePath.split('/').pop() ?? '';
    const purpose = child.overview?.purposeFirstParagraph ?? MISSING_DESCRIPTION_TOKEN;
    lines.push(
      `| [${folderName}/](./sub-domains/${folderName}/DOCS.md) | ${truncateForTableCell(purpose)} |`,
    );
  }
  lines.push('');
}

function appendRoutesTable(lines: string[], routes: RouteEntry[]): void {
  if (routes.length === 0) return;

  lines.push('## Routes');
  lines.push('');
  lines.push('| Method | Path | Access | Description |');
  lines.push('| --- | --- | --- | --- |');
  for (const route of routes) {
    const description = route.description ?? route.summary ?? MISSING_DESCRIPTION_TOKEN;
    lines.push(
      `| ${route.method} | \`${route.fullPath}\` | ${route.access} | ${truncateForTableCell(description)} |`,
    );
  }
  lines.push('');
}

function appendExportsByRole(lines: string[], files: DocumentedFile[]): void {
  const filesByRole = new Map<string, DocumentedFile[]>();
  for (const file of files) {
    const list = filesByRole.get(file.role) ?? [];
    list.push(file);
    filesByRole.set(file.role, list);
  }

  for (const role of ROLE_RENDER_ORDER) {
    const filesForRole = filesByRole.get(role);
    if (!filesForRole || filesForRole.length === 0) continue;
    if (role === 'routes') continue;

    const heading = FILE_ROLE_DISPLAY_LABELS[role] ?? role;
    const exportsForRole = filesForRole.flatMap((file) =>
      file.exports.filter((symbol) => !symbol.isInternal).map((symbol) => ({ file, symbol })),
    );
    if (exportsForRole.length === 0) continue;

    lines.push(`## ${heading}`);
    lines.push('');
    for (const { file, symbol } of exportsForRole) {
      appendSymbolEntry(lines, file, symbol);
    }
  }
}

function appendSymbolEntry(lines: string[], file: DocumentedFile, symbol: ExportedSymbol): void {
  lines.push(`### \`${symbol.name}\``);
  lines.push('');
  lines.push(`Source: \`${file.relativePath}\``);
  lines.push('');

  if (symbol.summary) {
    lines.push(symbol.summary);
  } else {
    lines.push(MISSING_DESCRIPTION_TOKEN);
  }
  lines.push('');

  if (symbol.remarks) {
    lines.push('<details><summary>Business logic</summary>');
    lines.push('');
    lines.push(symbol.remarks);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  } else if (file.isServiceLike) {
    lines.push(MISSING_REMARKS_TOKEN);
    lines.push('');
    lines.push(`Public export in \`${file.fileName}\` requires a \`@remarks\` block.`);
    lines.push('');
  } else if (file.isPolicyLike) {
    lines.push(MISSING_REMARKS_TOKEN);
    lines.push('');
    lines.push(
      `Policy constant requires a \`@remarks\` block (rationale + consequences + last reviewed).`,
    );
    lines.push('');
  }

  if (symbol.parserErrors.length > 0) {
    lines.push('> TSDoc parser warnings:');
    for (const errorMessage of symbol.parserErrors) {
      lines.push(`> - ${errorMessage}`);
    }
    lines.push('');
  }
}

function appendOverviewIssues(lines: string[], folder: DocumentedFolder): void {
  if (!folder.overview) return;
  if (folder.overview.missingRequiredSections.length === 0) return;

  lines.push('## Overview gaps');
  lines.push('');
  lines.push(MISSING_OVERVIEW_SECTION_TOKEN);
  lines.push('');
  for (const missing of folder.overview.missingRequiredSections) {
    lines.push(`- Missing required section: \`${missing}\``);
  }
  lines.push('');
}

function truncateForTableCell(value: string): string {
  const single = value.replace(/\n+/g, ' ').trim();
  if (single.length <= 200) return single;
  return `${single.slice(0, 200)}…`;
}

export function deriveExpectedFirstLinePath({
  folderAbsolutePath,
}: {
  folderAbsolutePath: string;
}): string {
  const relativePath = relative(REPO_ROOT, folderAbsolutePath).split(sep).join('/');
  return `${relativePath}/`;
}

export function deriveDocsAbsolutePath({
  folderAbsolutePath,
}: {
  folderAbsolutePath: string;
}): string {
  return join(folderAbsolutePath, PER_FOLDER_DOCS_FILENAME);
}

export function isDocsAbsolutePathInsideRepo(absolutePath: string): boolean {
  return absolutePath.startsWith(REPO_ROOT);
}

export function relativeFromRepoRoot(absolutePath: string): string {
  return relative(REPO_ROOT, absolutePath).split(sep).join('/');
}

export function joinFromRepoRoot(...segments: string[]): string {
  return join(REPO_ROOT, ...segments);
}

export function dirnameOf(absolutePath: string): string {
  return dirname(absolutePath);
}
