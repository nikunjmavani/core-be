/**
 * Extracts TSDoc summary and `@remarks` blocks from public exports in a
 * TypeScript source file.
 *
 * Pairing strategy: the comment must be the immediate predecessor of an
 * `export` declaration (allowing whitespace-only lines between them). Comment
 * content is parsed with `@microsoft/tsdoc` so malformed comments raise
 * parser errors that the hard gate can surface; summary and `@remarks` body
 * markdown are extracted by line-based scanning of the cleaned comment text
 * to keep the rendered `DOCS.md` markdown faithful to what authors wrote.
 */
import { readFileSync } from 'node:fs';
import { TSDocParser } from '@microsoft/tsdoc';
import type { ExportedSymbol } from './types.js';

const tsdocParser = new TSDocParser();

interface RawComment {
  rawText: string;
  cleanedLines: string[];
  startIndex: number;
  endIndex: number;
}

interface ExportDeclaration {
  name: string;
  kind: ExportedSymbol['kind'];
  declarationStartIndex: number;
}

const EXPORT_DECLARATION_PATTERN =
  /export\s+(?:default\s+)?(?:async\s+)?(?<keyword>function|class|const|let|var|interface|type|enum)\s+(?<name>[A-Za-z_$][\w$]*)/g;

function findRawComments(sourceText: string): RawComment[] {
  const comments: RawComment[] = [];
  const blockCommentPattern = /\/\*\*[\s\S]*?\*\//g;
  for (const match of sourceText.matchAll(blockCommentPattern)) {
    const rawText = match[0] ?? '';
    const startIndex = match.index ?? 0;
    const endIndex = startIndex + rawText.length;
    comments.push({
      rawText,
      cleanedLines: cleanCommentLines(rawText),
      startIndex,
      endIndex,
    });
  }
  return comments;
}

function cleanCommentLines(rawText: string): string[] {
  const inner = rawText.replace(/^\/\*\*/, '').replace(/\*\/$/, '');
  return inner
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, '').replace(/\s+$/, ''))
    .filter((line, index, all) => !(line === '' && (index === 0 || index === all.length - 1)));
}

function findExportDeclarations(sourceText: string): ExportDeclaration[] {
  const declarations: ExportDeclaration[] = [];
  for (const match of sourceText.matchAll(EXPORT_DECLARATION_PATTERN)) {
    const groups = match.groups ?? {};
    const name = groups.name ?? '';
    const keyword = groups.keyword ?? '';
    if (!name) continue;
    declarations.push({
      name,
      kind: keywordToKind(keyword),
      declarationStartIndex: match.index ?? 0,
    });
  }
  return declarations;
}

function keywordToKind(keyword: string): ExportedSymbol['kind'] {
  switch (keyword) {
    case 'function':
      return 'function';
    case 'class':
      return 'class';
    case 'const':
      return 'const';
    case 'let':
      return 'let';
    case 'var':
      return 'var';
    case 'interface':
      return 'interface';
    case 'type':
      return 'type';
    case 'enum':
      return 'enum';
    default:
      return 'unknown';
  }
}

function pairCommentToDeclaration(
  comment: RawComment,
  declarations: ExportDeclaration[],
  sourceText: string,
): ExportDeclaration | null {
  for (const declaration of declarations) {
    if (declaration.declarationStartIndex <= comment.endIndex) continue;
    const between = sourceText.slice(comment.endIndex, declaration.declarationStartIndex);
    if (/^[\s\r\n]*$/.test(between)) {
      return declaration;
    }
    return null;
  }
  return null;
}

function extractSummaryFromCleanedLines(cleanedLines: string[]): string {
  const collected: string[] = [];
  for (const line of cleanedLines) {
    if (line.startsWith('@')) break;
    collected.push(line);
  }
  return collected.join('\n').trim();
}

function extractRemarksFromCleanedLines(cleanedLines: string[]): string | null {
  const remarksHeaderIndex = cleanedLines.findIndex((line) => line.trim().startsWith('@remarks'));
  if (remarksHeaderIndex === -1) return null;
  const collected: string[] = [];
  for (let lineIndex = remarksHeaderIndex; lineIndex < cleanedLines.length; lineIndex += 1) {
    const line = cleanedLines[lineIndex] ?? '';
    if (lineIndex === remarksHeaderIndex) {
      const trailing = line.replace(/^@remarks\s*/, '').trim();
      if (trailing) collected.push(trailing);
      continue;
    }
    if (line.startsWith('@') && !line.startsWith('@link')) break;
    collected.push(line);
  }
  return collected.join('\n').trim() || null;
}

function detectModifierTagsFromComment(rawText: string): {
  isPublic: boolean;
  isInternal: boolean;
} {
  const parserContext = tsdocParser.parseString(rawText);
  const modifierTagSet = parserContext.docComment.modifierTagSet;
  return {
    isPublic: modifierTagSet.isPublic(),
    isInternal: modifierTagSet.isInternal(),
  };
}

function extractParserErrorMessages(rawText: string): string[] {
  const parserContext = tsdocParser.parseString(rawText);
  return parserContext.log.messages.map((message) => message.text);
}

export function extractExportedSymbolsFromFile(absoluteFilePath: string): ExportedSymbol[] {
  const sourceText = readFileSync(absoluteFilePath, 'utf-8');
  const comments = findRawComments(sourceText);
  const declarations = findExportDeclarations(sourceText);

  const declarationByCommentIndex = new Map<number, ExportDeclaration>();
  for (const comment of comments) {
    const paired = pairCommentToDeclaration(comment, declarations, sourceText);
    if (paired !== null) {
      declarationByCommentIndex.set(comment.startIndex, paired);
    }
  }

  const symbols: ExportedSymbol[] = [];
  const seenDeclarationIndexes = new Set<number>();

  for (const comment of comments) {
    const declaration = declarationByCommentIndex.get(comment.startIndex);
    if (!declaration) continue;

    const summary = extractSummaryFromCleanedLines(comment.cleanedLines);
    const remarks = extractRemarksFromCleanedLines(comment.cleanedLines);
    const modifierFlags = detectModifierTagsFromComment(comment.rawText);
    const parserErrors = extractParserErrorMessages(comment.rawText);

    symbols.push({
      name: declaration.name,
      kind: declaration.kind,
      summary: summary || null,
      remarks,
      isPublic: modifierFlags.isPublic || !modifierFlags.isInternal,
      isInternal: modifierFlags.isInternal,
      parserErrors,
    });

    seenDeclarationIndexes.add(declaration.declarationStartIndex);
  }

  for (const declaration of declarations) {
    if (seenDeclarationIndexes.has(declaration.declarationStartIndex)) continue;
    symbols.push({
      name: declaration.name,
      kind: declaration.kind,
      summary: null,
      remarks: null,
      isPublic: true,
      isInternal: false,
      parserErrors: [],
    });
  }

  symbols.sort((left, right) => left.name.localeCompare(right.name));
  return symbols;
}
