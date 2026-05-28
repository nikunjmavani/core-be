/**
 * Reads the four top-level system-narrative files at `src/` root:
 * `OVERVIEW.md`, `PATTERNS.md`, `FLOWS.md`, `POLICIES.md`.
 *
 * For each file, validates line 1 matches `src/` and that all required H2
 * sections (Phase 3 hard-gate criteria) are present. Missing files / sections
 * produce entries the renderer emits as `MISSING_SYSTEM_FILE` tokens in
 * `src/DOCS.md`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  SRC_FLOWS_FILENAME,
  SRC_OVERVIEW_FILENAME,
  SRC_PATTERNS_FILENAME,
  SRC_POLICIES_FILENAME,
  SRC_ROOT,
} from './constants.js';
import type { SystemDocuments, SystemFileDocument } from './types.js';

const REQUIRED_SECTIONS_BY_FILENAME: Record<SystemFileDocument['filename'], string[]> = {
  'OVERVIEW.md': [
    '## Purpose',
    '## Architecture at a glance',
    '## Domains',
    '## Patterns',
    '## End-to-end flows',
    '## Policies',
    '## Tech stack',
  ],
  'PATTERNS.md': [],
  'FLOWS.md': [],
  'POLICIES.md': [],
};

function extractTopLevelHeadings(markdownText: string): string[] {
  return markdownText
    .split('\n')
    .filter((line) => line.startsWith('## '))
    .map((line) => line.trim());
}

function extractFirstLinePath(markdownText: string): string | null {
  const firstLine = markdownText.split('\n')[0]?.trim() ?? '';
  if (firstLine.startsWith('`') && firstLine.endsWith('`')) {
    return firstLine.slice(1, -1);
  }
  return null;
}

function readSingleSystemFile(filename: SystemFileDocument['filename']): SystemFileDocument {
  const absolutePath = join(SRC_ROOT, filename);
  if (!existsSync(absolutePath)) {
    return {
      absolutePath,
      filename,
      exists: false,
      firstLinePath: null,
      topLevelHeadings: [],
      missingRequiredSections: REQUIRED_SECTIONS_BY_FILENAME[filename].slice(),
    };
  }

  const markdownText = readFileSync(absolutePath, 'utf-8');
  const topLevelHeadings = extractTopLevelHeadings(markdownText);
  const firstLinePath = extractFirstLinePath(markdownText);
  const requiredSections = REQUIRED_SECTIONS_BY_FILENAME[filename];
  const missingRequiredSections = requiredSections.filter(
    (heading) => !topLevelHeadings.includes(heading),
  );

  return {
    absolutePath,
    filename,
    exists: true,
    firstLinePath,
    topLevelHeadings,
    missingRequiredSections,
  };
}

export function readSystemDocuments(): SystemDocuments {
  return {
    overview: readSingleSystemFile(SRC_OVERVIEW_FILENAME as SystemFileDocument['filename']),
    patterns: readSingleSystemFile(SRC_PATTERNS_FILENAME as SystemFileDocument['filename']),
    flows: readSingleSystemFile(SRC_FLOWS_FILENAME as SystemFileDocument['filename']),
    policies: readSingleSystemFile(SRC_POLICIES_FILENAME as SystemFileDocument['filename']),
  };
}
