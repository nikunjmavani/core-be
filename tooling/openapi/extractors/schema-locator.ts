/**
 * Locates the options-object literal of a Fastify route registration call,
 * and the `schema:` property body inside it, using brace-balanced scanning.
 *
 * Used by both:
 * - the OpenAPI document builder (read-only — extracts schema metadata).
 * - the one-shot route-metadata migration codemod (writes new properties
 *   into the schema literal).
 *
 * Pure text helpers (no TypeScript AST) keep edits aligned with the original
 * formatting so the resulting diff stays minimal.
 */

export interface BalancedRange {
  openIndex: number;
  closeIndex: number;
  bodyStart: number;
  bodyEnd: number;
}

export function findOptionsObjectRange(
  sourceText: string,
  routeRegistrationStartIndex: number,
): BalancedRange | null {
  const openParenthesisIndex = sourceText.indexOf('(', routeRegistrationStartIndex);
  if (openParenthesisIndex === -1) return null;

  const pathStringIndex = findFirstStringLiteralIndex(sourceText, openParenthesisIndex + 1);
  if (pathStringIndex === null) return null;
  const cursorAfterPath = skipStringLiteral(sourceText, pathStringIndex);

  const commaIndex = findNextNonWhitespace(sourceText, cursorAfterPath);
  if (commaIndex === null || sourceText[commaIndex] !== ',') return null;

  const objectOpenIndex = findNextNonWhitespace(sourceText, commaIndex + 1);
  if (objectOpenIndex === null || sourceText[objectOpenIndex] !== '{') return null;

  const objectCloseIndex = findMatchingBrace(sourceText, objectOpenIndex);
  if (objectCloseIndex === null) return null;

  return {
    openIndex: objectOpenIndex,
    closeIndex: objectCloseIndex,
    bodyStart: objectOpenIndex + 1,
    bodyEnd: objectCloseIndex,
  };
}

export function findSchemaPropertyRange(optionsBodyText: string): BalancedRange | null {
  const propertyPattern = /(^|[\s,;{])schema\s*:\s*\{/g;
  let match: RegExpExecArray | null = propertyPattern.exec(optionsBodyText);
  while (match !== null) {
    const openIndex = optionsBodyText.indexOf('{', match.index);
    if (openIndex !== -1) {
      const closeIndex = findMatchingBrace(optionsBodyText, openIndex);
      if (closeIndex !== null) {
        return {
          openIndex,
          closeIndex,
          bodyStart: openIndex + 1,
          bodyEnd: closeIndex,
        };
      }
    }
    match = propertyPattern.exec(optionsBodyText);
  }
  return null;
}

export function findMatchingBrace(sourceText: string, openBraceIndex: number): number | null {
  if (sourceText[openBraceIndex] !== '{') return null;
  let depth = 0;
  for (let cursor = openBraceIndex; cursor < sourceText.length; cursor += 1) {
    const character = sourceText[cursor];
    if (character === '"' || character === "'" || character === '`') {
      cursor = skipStringLiteral(sourceText, cursor) - 1;
      continue;
    }
    if (character === '/' && sourceText[cursor + 1] === '/') {
      cursor = sourceText.indexOf('\n', cursor);
      if (cursor === -1) return null;
      continue;
    }
    if (character === '/' && sourceText[cursor + 1] === '*') {
      const end = sourceText.indexOf('*/', cursor + 2);
      if (end === -1) return null;
      cursor = end + 1;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return null;
}

function findFirstStringLiteralIndex(sourceText: string, start: number): number | null {
  for (let cursor = start; cursor < sourceText.length; cursor += 1) {
    const character = sourceText[cursor];
    if (character === '"' || character === "'" || character === '`') return cursor;
    if (character === '<') {
      const closeAngle = findMatchingAngle(sourceText, cursor);
      if (closeAngle === null) return null;
      cursor = closeAngle;
      continue;
    }
    if (character === undefined) return null;
    if (!/\s/.test(character)) return null;
  }
  return null;
}

function findMatchingAngle(sourceText: string, openAngleIndex: number): number | null {
  if (sourceText[openAngleIndex] !== '<') return null;
  let depth = 0;
  for (let cursor = openAngleIndex; cursor < sourceText.length; cursor += 1) {
    const character = sourceText[cursor];
    if (character === '<') depth += 1;
    else if (character === '>') {
      depth -= 1;
      if (depth === 0) return cursor;
    }
  }
  return null;
}

function skipStringLiteral(sourceText: string, openQuoteIndex: number): number {
  const quote = sourceText[openQuoteIndex];
  if (quote !== '"' && quote !== "'" && quote !== '`') return openQuoteIndex + 1;
  for (let cursor = openQuoteIndex + 1; cursor < sourceText.length; cursor += 1) {
    const character = sourceText[cursor];
    if (character === '\\') {
      cursor += 1;
      continue;
    }
    if (character === quote) return cursor + 1;
  }
  return sourceText.length;
}

function findNextNonWhitespace(sourceText: string, start: number): number | null {
  for (let cursor = start; cursor < sourceText.length; cursor += 1) {
    const character = sourceText[cursor];
    if (character === undefined) return null;
    if (!/\s/.test(character)) return cursor;
  }
  return null;
}
