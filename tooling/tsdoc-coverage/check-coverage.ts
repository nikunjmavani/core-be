/**
 * TSDoc coverage gate.
 *
 * Replaces the retired `pnpm features:*` system. Walks `src/**\/*.ts` (skipping
 * test fixtures, sub-domains, and generated artifacts), finds every public
 * export, and reports two classes of missing documentation:
 *
 * - `MISSING_DESCRIPTION` — a public export has no TSDoc summary.
 * - `MISSING_REMARKS` — a public export in a "service-like" file
 *   (`*.service.ts`, `*.worker.ts`, `*.processor.ts`) or a "policy-like"
 *   file (`*.policy.ts`) has no `@remarks` block.
 *
 * Behavior is budget-driven: the script reads
 * `tooling/tsdoc-coverage/budget.json` and fails when either count exceeds the
 * locked budget. PRs can drop the budget (after fixing TSDoc); they can never
 * raise it.
 *
 * CLI:
 *
 * - `pnpm tsdoc:check`               → enforce budget, exit 1 if exceeded.
 * - `pnpm tsdoc:check --report`      → also list every (file, symbol) pair
 *                                       still missing docs (informational).
 * - `pnpm tsdoc:check --refresh-budget`
 *                                    → rewrite budget.json with the current
 *                                       counts. Use with care; commit the
 *                                       reduction along with the fixes.
 *
 * The script intentionally does NOT render markdown. Per-symbol TSDoc is the
 * canonical source; OVERVIEW.md remains the hand-written narrative; routes
 * stay on Zod schemas which drive OpenAPI. There is no auto-generated
 * `DOCS.md` layer in this project.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { TSDocParser } from '@microsoft/tsdoc';

const REPO_ROOT = resolve(process.cwd());
const SRC_ROOT = resolve(REPO_ROOT, 'src');
const BUDGET_FILE = resolve(REPO_ROOT, 'tooling/tsdoc-coverage/budget.json');

const FOLDER_NAMES_TO_SKIP = new Set([
  'node_modules',
  'dist',
  '.git',
  '__tests__',
  '__test__',
  '__mocks__',
  '__fixtures__',
  'fixtures',
  'helpers',
  'factories',
]);

const TEST_FILE_SUFFIXES = [
  '.test.ts',
  '.spec.ts',
  '.unit.test.ts',
  '.integration.test.ts',
  '.e2e.test.ts',
  '.contract.test.ts',
  '.chaos.test.ts',
  '.property.test.ts',
  '.security.test.ts',
  '.performance.test.ts',
  '.global.test.ts',
];

const SERVICE_LIKE_FILE_PATTERN = /\.(service|worker|processor)\.ts$/;
const POLICY_LIKE_FILE_PATTERN = /\.policy\.ts$/;

const EXPORT_DECLARATION_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(?<name>[A-Za-z_$][\w$]*)/g;

interface RawComment {
  rawText: string;
  cleanedLines: string[];
  startIndex: number;
  endIndex: number;
}

interface ExportDeclaration {
  name: string;
  declarationStartIndex: number;
}

interface ExportedSymbol {
  name: string;
  hasSummary: boolean;
  hasRemarks: boolean;
  isInternal: boolean;
}

interface MissingEntry {
  filePath: string;
  symbolName: string;
  needs: 'summary' | 'remarks' | 'summary+remarks';
}

interface Budget {
  tokens: {
    MISSING_DESCRIPTION: number;
    MISSING_REMARKS: number;
  };
}

const tsdocParser = new TSDocParser();

function listSourceFilesRecursively(rootPath: string): string[] {
  const collected: string[] = [];
  const walk = (currentPath: string) => {
    let entries: string[];
    try {
      entries = readdirSync(currentPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (FOLDER_NAMES_TO_SKIP.has(entry)) continue;
      if (entry.startsWith('.')) continue;
      const absolutePath = join(currentPath, entry);
      const stats = statSync(absolutePath);
      if (stats.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (!entry.endsWith('.ts')) continue;
      if (TEST_FILE_SUFFIXES.some((suffix) => entry.endsWith(suffix))) continue;
      collected.push(absolutePath);
    }
  };
  walk(rootPath);
  return collected;
}

function cleanCommentLines(rawText: string): string[] {
  const inner = rawText.replace(/^\/\*\*/, '').replace(/\*\/$/, '');
  return inner
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').replace(/\s+$/, ''))
    .filter((line, index, all) => !(line === '' && (index === 0 || index === all.length - 1)));
}

function findRawComments(sourceText: string): RawComment[] {
  const comments: RawComment[] = [];
  const blockCommentPattern = /\/\*\*[\s\S]*?\*\//g;
  for (const match of sourceText.matchAll(blockCommentPattern)) {
    const rawText = match[0] ?? '';
    const startIndex = match.index ?? 0;
    comments.push({
      rawText,
      cleanedLines: cleanCommentLines(rawText),
      startIndex,
      endIndex: startIndex + rawText.length,
    });
  }
  return comments;
}

function findExportDeclarations(sourceText: string): ExportDeclaration[] {
  const declarations: ExportDeclaration[] = [];
  for (const match of sourceText.matchAll(EXPORT_DECLARATION_PATTERN)) {
    const name = match.groups?.name ?? '';
    if (!name) continue;
    declarations.push({ name, declarationStartIndex: match.index ?? 0 });
  }
  return declarations;
}

function pairCommentToDeclaration(
  comment: RawComment,
  declarations: ExportDeclaration[],
  sourceText: string,
): ExportDeclaration | null {
  for (const declaration of declarations) {
    if (declaration.declarationStartIndex <= comment.endIndex) continue;
    const between = sourceText.slice(comment.endIndex, declaration.declarationStartIndex);
    if (/^[\s\r\n]*$/.test(between)) return declaration;
    return null;
  }
  return null;
}

function commentHasSummary(cleanedLines: string[]): boolean {
  for (const line of cleanedLines) {
    if (line.startsWith('@')) return false;
    if (line.trim().length > 0) return true;
  }
  return false;
}

function commentHasRemarks(cleanedLines: string[]): boolean {
  return cleanedLines.some((line) => line.trim().startsWith('@remarks'));
}

function commentIsInternal(rawText: string): boolean {
  const parserContext = tsdocParser.parseString(rawText);
  return parserContext.docComment.modifierTagSet.isInternal();
}

function extractSymbolsFromFile(absoluteFilePath: string): ExportedSymbol[] {
  const sourceText = readFileSync(absoluteFilePath, 'utf-8');
  const comments = findRawComments(sourceText);
  const declarations = findExportDeclarations(sourceText);

  const declarationByCommentStart = new Map<number, ExportDeclaration>();
  for (const comment of comments) {
    const paired = pairCommentToDeclaration(comment, declarations, sourceText);
    if (paired !== null) declarationByCommentStart.set(comment.startIndex, paired);
  }

  const symbols: ExportedSymbol[] = [];
  const seenDeclarationIndexes = new Set<number>();

  for (const comment of comments) {
    const declaration = declarationByCommentStart.get(comment.startIndex);
    if (!declaration) continue;
    symbols.push({
      name: declaration.name,
      hasSummary: commentHasSummary(comment.cleanedLines),
      hasRemarks: commentHasRemarks(comment.cleanedLines),
      isInternal: commentIsInternal(comment.rawText),
    });
    seenDeclarationIndexes.add(declaration.declarationStartIndex);
  }

  for (const declaration of declarations) {
    if (seenDeclarationIndexes.has(declaration.declarationStartIndex)) continue;
    symbols.push({
      name: declaration.name,
      hasSummary: false,
      hasRemarks: false,
      isInternal: false,
    });
  }

  return symbols;
}

function loadBudget(): Budget {
  try {
    const raw = readFileSync(BUDGET_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as { tokens?: Record<string, number> };
    return {
      tokens: {
        MISSING_DESCRIPTION: parsed.tokens?.MISSING_DESCRIPTION ?? 0,
        MISSING_REMARKS: parsed.tokens?.MISSING_REMARKS ?? 0,
      },
    };
  } catch {
    return { tokens: { MISSING_DESCRIPTION: 0, MISSING_REMARKS: 0 } };
  }
}

function writeBudget(budget: Budget): void {
  const payload = {
    _comment:
      'Locked TSDoc-coverage budget. The gate (`pnpm tsdoc:check`) fails when either count exceeds these numbers. PRs may LOWER counts (and refresh this file via `pnpm tsdoc:check --refresh-budget`); they may not raise them.',
    _recordedAt: new Date().toISOString().slice(0, 10),
    tokens: budget.tokens,
  };
  writeFileSync(BUDGET_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8');
}

function computeNeedsLabel(needsSummary: boolean, needsRemarks: boolean): MissingEntry['needs'] {
  if (needsSummary && needsRemarks) return 'summary+remarks';
  if (needsSummary) return 'summary';
  return 'remarks';
}

function collectMissing(): MissingEntry[] {
  const missing: MissingEntry[] = [];
  const sourceFiles = listSourceFilesRecursively(SRC_ROOT);
  for (const absoluteFilePath of sourceFiles) {
    const relativePath = relative(REPO_ROOT, absoluteFilePath);
    const fileName = relativePath.split('/').pop() ?? '';
    const isServiceLike = SERVICE_LIKE_FILE_PATTERN.test(fileName);
    const isPolicyLike = POLICY_LIKE_FILE_PATTERN.test(fileName);
    const symbols = extractSymbolsFromFile(absoluteFilePath);
    for (const symbol of symbols) {
      if (symbol.isInternal) continue;
      const needsSummary = !symbol.hasSummary;
      const needsRemarks = (isServiceLike || isPolicyLike) && !symbol.hasRemarks;
      if (!(needsSummary || needsRemarks)) continue;
      const needs: MissingEntry['needs'] = computeNeedsLabel(needsSummary, needsRemarks);
      missing.push({ filePath: relativePath, symbolName: symbol.name, needs });
    }
  }
  missing.sort((left, right) => {
    if (left.filePath !== right.filePath) return left.filePath.localeCompare(right.filePath);
    return left.symbolName.localeCompare(right.symbolName);
  });
  return missing;
}

function summariseCounts(missing: MissingEntry[]): {
  missingDescription: number;
  missingRemarks: number;
} {
  let missingDescription = 0;
  let missingRemarks = 0;
  for (const entry of missing) {
    if (entry.needs === 'summary' || entry.needs === 'summary+remarks') missingDescription += 1;
    if (entry.needs === 'remarks' || entry.needs === 'summary+remarks') missingRemarks += 1;
  }
  return { missingDescription, missingRemarks };
}

function main(): void {
  const argv = process.argv.slice(2);
  const isRefresh = argv.includes('--refresh-budget');
  const isReport = argv.includes('--report');

  const missing = collectMissing();
  const counts = summariseCounts(missing);

  if (isRefresh) {
    writeBudget({
      tokens: {
        MISSING_DESCRIPTION: counts.missingDescription,
        MISSING_REMARKS: counts.missingRemarks,
      },
    });
    console.log(
      `tsdoc:check --refresh-budget — wrote tooling/tsdoc-coverage/budget.json (MISSING_DESCRIPTION=${counts.missingDescription}, MISSING_REMARKS=${counts.missingRemarks}).`,
    );
    return;
  }

  if (isReport) {
    for (const entry of missing) {
      console.log(`${entry.filePath}\t${entry.symbolName}\t${entry.needs}`);
    }
  }

  const budget = loadBudget();
  const exceededDescription = counts.missingDescription > budget.tokens.MISSING_DESCRIPTION;
  const exceededRemarks = counts.missingRemarks > budget.tokens.MISSING_REMARKS;

  console.log(
    `tsdoc:check — MISSING_DESCRIPTION=${counts.missingDescription} (budget ${budget.tokens.MISSING_DESCRIPTION}), MISSING_REMARKS=${counts.missingRemarks} (budget ${budget.tokens.MISSING_REMARKS}).`,
  );

  if (exceededDescription || exceededRemarks) {
    console.error('tsdoc:check FAILED — counts exceed locked budget.');
    if (exceededDescription) {
      console.error(
        `  MISSING_DESCRIPTION over budget by ${counts.missingDescription - budget.tokens.MISSING_DESCRIPTION}.`,
      );
    }
    if (exceededRemarks) {
      console.error(
        `  MISSING_REMARKS over budget by ${counts.missingRemarks - budget.tokens.MISSING_REMARKS}.`,
      );
    }
    console.error(
      '  Add TSDoc on the offending exports, or run `pnpm tsdoc:check --report` to list them.',
    );
    process.exit(1);
  }

  if (
    counts.missingDescription < budget.tokens.MISSING_DESCRIPTION ||
    counts.missingRemarks < budget.tokens.MISSING_REMARKS
  ) {
    console.log(
      'tsdoc:check — counts have decreased; run `pnpm tsdoc:check --refresh-budget` to lock the new lower budget.',
    );
  }
}

main();
