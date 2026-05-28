/**
 * Layered feature-docs generator.
 *
 * Produces:
 * - `<folder>/DOCS.md` per documented directory under `src/`.
 * - `src/DOCS.md` — top-level catalog index linking system narratives and per-area folders.
 *
 * Sources (per the layered documentation model):
 * - Zod route schema `summary` + `description` directly on Fastify route registrations.
 * - Per-folder `OVERVIEW.md` (Templates A.1 / A.2 / A.3 / A.4 selected by path).
 * - TSDoc summary + `@remarks` block on every public exported symbol.
 * - The four system-narrative files at `src/` root (`OVERVIEW.md`, `PATTERNS.md`, `FLOWS.md`, `POLICIES.md`).
 *
 * Modes:
 * - `pnpm features:generate` — write all `DOCS.md` files in place.
 * - `pnpm features:check` — regenerate in memory and diff vs committed; report drift and missing tokens.
 * - `pnpm features:check:strict` — same as `--check`, plus exit non-zero when committed
 *   `DOCS.md` is out of sync OR any missing-token count exceeds the locked baseline at
 *   `tooling/feature-docs/missing-tokens.baseline.json`. Wired into `.husky/pre-commit`,
 *   `ci:local`, and `ci:quality`.
 * - `pnpm features:refresh-baseline` — rewrite the baseline file with the current counts.
 *   Run **after** consciously reducing missing-token counts so the new (lower) ratchet
 *   prevents future regression.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MISSING_TOKENS, MISSING_TOKENS_BASELINE_FILE } from '@tooling/feature-docs/constants.js';
import { renderFolderDocs } from '@tooling/feature-docs/docs-renderer.js';
import {
  classifyFile,
  isPolicyLikeFile,
  isServiceLikeFile,
} from '@tooling/feature-docs/file-classifier.js';
import { discoverDocumentedFolders } from '@tooling/feature-docs/folder-discovery.js';
import { renderSrcDocsIndex } from '@tooling/feature-docs/index-renderer.js';
import { readOverviewDocument } from '@tooling/feature-docs/overview-reader.js';
import { collectRoutesByFolder } from '@tooling/feature-docs/route-extractor.js';
import { readSystemDocuments } from '@tooling/feature-docs/system-files-reader.js';
import { extractExportedSymbolsFromFile } from '@tooling/feature-docs/tsdoc-extractor.js';
import type {
  DocumentedFile,
  DocumentedFolder,
  GeneratorReport,
  RenderedDocument,
} from '@tooling/feature-docs/types.js';

interface RunOptions {
  checkOnly: boolean;
  strict: boolean;
  refreshBaseline: boolean;
}

interface BaselineFile {
  tokens: Record<string, number>;
}

interface BaselineComparison {
  ok: boolean;
  regressions: Array<{ token: string; baseline: number; current: number }>;
}

function loadBaseline(): BaselineFile {
  if (!existsSync(MISSING_TOKENS_BASELINE_FILE)) {
    return { tokens: Object.fromEntries(MISSING_TOKENS.map((token) => [token, 0])) };
  }
  const parsed = JSON.parse(readFileSync(MISSING_TOKENS_BASELINE_FILE, 'utf-8')) as {
    tokens?: Record<string, number>;
  };
  return { tokens: parsed.tokens ?? {} };
}

function compareToBaseline({
  baseline,
  current,
}: {
  baseline: BaselineFile;
  current: Record<string, number>;
}): BaselineComparison {
  const regressions: BaselineComparison['regressions'] = [];
  for (const token of MISSING_TOKENS) {
    const baselineCount = baseline.tokens[token] ?? 0;
    const currentCount = current[token] ?? 0;
    if (currentCount > baselineCount) {
      regressions.push({ token, baseline: baselineCount, current: currentCount });
    }
  }
  return { ok: regressions.length === 0, regressions };
}

function writeBaseline(currentCounts: Record<string, number>): void {
  const recordedAt = new Date().toISOString().slice(0, 10);
  const tokens: Record<string, number> = {};
  for (const token of MISSING_TOKENS) {
    tokens[token] = currentCounts[token] ?? 0;
  }
  const payload = {
    _comment:
      "Locked baseline of missing-token counts. The hard gate (`pnpm features:check --strict`) fails when any token's count exceeds the baseline. PRs may reduce counts (and refresh this file via `pnpm features:check --refresh-baseline`); they may not increase them.",
    _recordedAt: recordedAt,
    tokens,
  };
  writeFileSync(MISSING_TOKENS_BASELINE_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function buildDocumentedFiles(typeScriptFiles: string[]): DocumentedFile[] {
  const files: DocumentedFile[] = [];
  for (const absolutePath of typeScriptFiles) {
    const fileName = absolutePath.split('/').pop() ?? '';
    const role = classifyFile(fileName);
    const exports = extractExportedSymbolsFromFile(absolutePath);
    files.push({
      absolutePath,
      relativePath: absolutePath.replace(`${process.cwd()}/`, ''),
      fileName,
      role,
      isServiceLike: isServiceLikeFile(fileName),
      isPolicyLike: isPolicyLikeFile(fileName),
      exports,
    });
  }
  files.sort((left, right) => left.fileName.localeCompare(right.fileName));
  return files;
}

function buildDocumentedFolders(): DocumentedFolder[] {
  const discovered = discoverDocumentedFolders();
  const { routesByFolderRelativePath } = collectRoutesByFolder();
  const folders: DocumentedFolder[] = [];

  for (const folder of discovered) {
    const overview = folder.overviewVariant
      ? readOverviewDocument({
          folderAbsolutePath: folder.absolutePath,
          variant: folder.overviewVariant,
        })
      : null;

    const routes = routesByFolderRelativePath.get(folder.relativePath) ?? [];

    folders.push({
      absolutePath: folder.absolutePath,
      relativePath: folder.relativePath,
      pathLabel: folder.pathLabel,
      role: folder.role,
      parentRelativePath: folder.parentAbsolutePath
        ? folder.parentAbsolutePath.replace(`${process.cwd()}/`, '')
        : null,
      childRelativePaths: [],
      files: buildDocumentedFiles(folder.typeScriptFiles),
      routes,
      overview,
      overviewVariant: folder.overviewVariant,
      overviewExpected: folder.overviewExpected,
    });
  }

  attachChildRelativePaths(folders);
  return folders;
}

function attachChildRelativePaths(folders: DocumentedFolder[]): void {
  const folderByAbsolutePath = new Map(folders.map((folder) => [folder.absolutePath, folder]));
  for (const folder of folders) {
    if (!folder.parentRelativePath) continue;
    const parent = folders.find(
      (candidate) => candidate.relativePath === folder.parentRelativePath,
    );
    if (parent) {
      parent.childRelativePaths.push(folder.relativePath);
    }
  }
  void folderByAbsolutePath;
}

function buildChildFoldersByParentMap(
  folders: DocumentedFolder[],
): Map<string, DocumentedFolder[]> {
  const childFoldersByParent = new Map<string, DocumentedFolder[]>();
  for (const folder of folders) {
    const parent = dirname(folder.absolutePath);
    const list = childFoldersByParent.get(parent) ?? [];
    list.push(folder);
    childFoldersByParent.set(parent, list);
  }
  return childFoldersByParent;
}

function countMissingTokens(documents: RenderedDocument[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const document of documents) {
    for (const token of MISSING_TOKENS) {
      const matches = document.contents.split(token).length - 1;
      if (matches > 0) {
        counts[token] = (counts[token] ?? 0) + matches;
      }
    }
  }
  return counts;
}

function buildReport({
  folders,
  rendered,
}: {
  folders: DocumentedFolder[];
  rendered: RenderedDocument[];
}): GeneratorReport {
  const routesCatalogged = folders.reduce((sum, folder) => sum + folder.routes.length, 0);
  const exportsCatalogged = folders.reduce(
    (sum, folder) => sum + folder.files.reduce((inner, file) => inner + file.exports.length, 0),
    0,
  );

  return {
    documentsWritten: 0,
    documentsUnchanged: 0,
    documentedFolders: folders.length,
    routesCatalogged,
    exportsCatalogged,
    missingTokenCounts: countMissingTokens(rendered),
  };
}

function diffAgainstDisk(rendered: RenderedDocument[]): {
  changed: RenderedDocument[];
  unchanged: RenderedDocument[];
} {
  const changed: RenderedDocument[] = [];
  const unchanged: RenderedDocument[] = [];
  for (const document of rendered) {
    if (!existsSync(document.absolutePath)) {
      changed.push(document);
      continue;
    }
    const existing = readFileSync(document.absolutePath, 'utf-8');
    if (existing === document.contents) {
      unchanged.push(document);
    } else {
      changed.push(document);
    }
  }
  return { changed, unchanged };
}

function writeRenderedDocuments(documents: RenderedDocument[]): void {
  for (const document of documents) {
    mkdirSync(dirname(document.absolutePath), { recursive: true });
    writeFileSync(document.absolutePath, document.contents, 'utf-8');
  }
}

function logReport(report: GeneratorReport, mode: 'generate' | 'check'): void {
  console.log(`feature-docs (${mode}):`);
  console.log(`  documented folders   = ${report.documentedFolders}`);
  console.log(`  routes catalogged    = ${report.routesCatalogged}`);
  console.log(`  exports catalogged   = ${report.exportsCatalogged}`);
  console.log(`  documents written    = ${report.documentsWritten}`);
  console.log(`  documents unchanged  = ${report.documentsUnchanged}`);
  if (Object.keys(report.missingTokenCounts).length === 0) {
    console.log('  missing tokens       = 0');
    return;
  }
  console.log('  missing tokens (gated against locked baseline; see --strict mode):');
  for (const [token, count] of Object.entries(report.missingTokenCounts).sort()) {
    console.log(`    ${token} × ${count}`);
  }
}

function logBaselineComparison(comparison: BaselineComparison, baseline: BaselineFile): void {
  if (comparison.ok) {
    console.log('  baseline             = OK (no token count exceeds the locked baseline)');
    return;
  }
  console.warn('  baseline             = REGRESSION');
  for (const entry of comparison.regressions) {
    console.warn(
      `    ${entry.token} × ${entry.current} (baseline: ${entry.baseline}, +${entry.current - entry.baseline})`,
    );
  }
  void baseline;
}

function main(): void {
  const argv = process.argv;
  const options: RunOptions = {
    checkOnly: argv.includes('--check'),
    strict: argv.includes('--strict'),
    refreshBaseline: argv.includes('--refresh-baseline'),
  };

  const folders = buildDocumentedFolders();
  const childFoldersByParent = buildChildFoldersByParentMap(folders);
  const systemDocuments = readSystemDocuments();

  const rendered: RenderedDocument[] = folders.map((folder) =>
    renderFolderDocs({ folder, childFoldersByParent }),
  );

  const report = buildReport({ folders, rendered });
  rendered.push(renderSrcDocsIndex({ documentedFolders: folders, systemDocuments, report }));

  const finalReport: GeneratorReport = {
    ...report,
    missingTokenCounts: countMissingTokens(rendered),
  };

  if (options.refreshBaseline) {
    writeBaseline(finalReport.missingTokenCounts);
    console.log(
      `feature-docs: refreshed baseline at ${MISSING_TOKENS_BASELINE_FILE.replace(`${process.cwd()}/`, '')}`,
    );
    for (const [token, count] of Object.entries(finalReport.missingTokenCounts).sort()) {
      console.log(`  ${token} × ${count}`);
    }
    process.exit(0);
    return;
  }

  const baseline = loadBaseline();
  const baselineComparison = compareToBaseline({
    baseline,
    current: finalReport.missingTokenCounts,
  });

  if (options.checkOnly) {
    const { changed, unchanged } = diffAgainstDisk(rendered);
    finalReport.documentsWritten = 0;
    finalReport.documentsUnchanged = unchanged.length;
    logReport(finalReport, 'check');
    logBaselineComparison(baselineComparison, baseline);

    if (changed.length > 0) {
      console.warn(`\nfeature-docs: ${changed.length} file(s) out of sync with sources:`);
      for (const document of changed.slice(0, 20)) {
        console.warn(`  - ${document.absolutePath}`);
      }
      if (changed.length > 20) {
        console.warn(`  ...and ${changed.length - 20} more`);
      }
      console.warn('Run `pnpm features:generate` to refresh.');
    }

    if (options.strict) {
      const driftFailure = changed.length > 0;
      const baselineFailure = !baselineComparison.ok;
      if (driftFailure || baselineFailure) {
        if (driftFailure) {
          console.error(
            '\nfeature-docs (strict): committed DOCS.md / src/DOCS.md is out of sync with sources.',
          );
        }
        if (baselineFailure) {
          console.error(
            '\nfeature-docs (strict): one or more missing-token counts exceed the locked baseline.',
          );
          console.error('Either:');
          console.error(
            '  (a) add the required TSDoc / OVERVIEW.md / system-narrative content to bring the count back to baseline,',
          );
          console.error(
            '  (b) consciously reduce the baseline by running `pnpm features:check --refresh-baseline` after the count goes DOWN, or',
          );
          console.error(
            '  (c) ask reviewers for an exception and update the baseline file with justification.',
          );
        }
        process.exit(1);
      }
    }
    process.exit(0);
    return;
  }

  const { changed, unchanged } = diffAgainstDisk(rendered);
  writeRenderedDocuments(changed);
  finalReport.documentsWritten = changed.length;
  finalReport.documentsUnchanged = unchanged.length;
  logReport(finalReport, 'generate');
  logBaselineComparison(baselineComparison, baseline);
}

main();
