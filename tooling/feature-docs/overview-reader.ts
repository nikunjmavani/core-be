/**
 * Reads `OVERVIEW.md` for a documented folder and extracts the H2 sections
 * the renderer needs (Purpose first paragraph, Sub-domains table, etc.).
 *
 * Required sections per variant:
 * - A.1 (domain): Purpose, Key invariants, Sub-domains, Patterns used, Cross-domain flows.
 * - A.2 (sub-domain incl. nested): Purpose, Key invariants, Lifecycle.
 * - A.3 (infra/shared module): Purpose, Design decisions.
 * - A.4 (test suite): Purpose.
 *
 * Validation that fails (missing line-1 path, missing required heading, empty
 * body under a required heading) produces entries in
 * `OverviewDocument.missingRequiredSections`. The renderer surfaces these as
 * `MISSING_OVERVIEW_SECTION` tokens in the per-folder `DOCS.md`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PER_FOLDER_OVERVIEW_FILENAME } from './constants.js';
import type { OverviewDocument, OverviewSection, OverviewVariant } from './types.js';

const REQUIRED_SECTIONS_BY_VARIANT: Record<OverviewVariant, string[]> = {
  'A.1-domain': [
    '## Purpose',
    '## Key invariants',
    '## Sub-domains',
    '## Patterns used',
    '## Cross-domain flows',
  ],
  'A.2-sub-domain': ['## Purpose', '## Key invariants', '## Lifecycle'],
  'A.3-infra-shared': ['## Purpose', '## Design decisions'],
  'A.4-test-suite': ['## Purpose'],
};

function splitIntoSections(markdownText: string): OverviewSection[] {
  const lines = markdownText.split('\n');
  const sections: OverviewSection[] = [];
  let currentHeading: string | null = null;
  let currentBodyLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('## ')) {
      if (currentHeading !== null) {
        sections.push({
          heading: currentHeading,
          bodyMarkdown: currentBodyLines.join('\n').trim(),
        });
      }
      currentHeading = line.trim();
      currentBodyLines = [];
      continue;
    }
    if (currentHeading !== null) {
      currentBodyLines.push(line);
    }
  }

  if (currentHeading !== null) {
    sections.push({ heading: currentHeading, bodyMarkdown: currentBodyLines.join('\n').trim() });
  }

  return sections;
}

function extractFirstLinePath(markdownText: string): string | null {
  const firstLine = markdownText.split('\n')[0]?.trim() ?? '';
  if (firstLine.startsWith('`') && firstLine.endsWith('`')) {
    return firstLine.slice(1, -1);
  }
  return null;
}

function extractPurposeFirstParagraph(sections: OverviewSection[]): string | null {
  const purposeSection = sections.find((section) => section.heading === '## Purpose');
  if (!purposeSection) return null;
  const paragraphs = purposeSection.bodyMarkdown.split(/\n\s*\n/);
  const firstParagraph = paragraphs[0]?.trim() ?? '';
  return firstParagraph.length > 0 ? firstParagraph : null;
}

function findMissingRequiredSections(
  variant: OverviewVariant,
  sections: OverviewSection[],
): string[] {
  const requiredHeadings = REQUIRED_SECTIONS_BY_VARIANT[variant];
  const missing: string[] = [];
  for (const requiredHeading of requiredHeadings) {
    const matchingSection = sections.find((section) => section.heading === requiredHeading);
    if (!matchingSection) {
      missing.push(requiredHeading);
      continue;
    }
    if (matchingSection.bodyMarkdown.length === 0) {
      missing.push(`${requiredHeading} (empty body)`);
    }
  }
  return missing;
}

export function readOverviewDocument({
  folderAbsolutePath,
  variant,
}: {
  folderAbsolutePath: string;
  variant: OverviewVariant;
}): OverviewDocument | null {
  const overviewAbsolutePath = join(folderAbsolutePath, PER_FOLDER_OVERVIEW_FILENAME);
  if (!existsSync(overviewAbsolutePath)) return null;

  const markdownText = readFileSync(overviewAbsolutePath, 'utf-8');
  const sections = splitIntoSections(markdownText);
  const firstLinePath = extractFirstLinePath(markdownText);
  const missingRequiredSections = findMissingRequiredSections(variant, sections);
  const purposeFirstParagraph = extractPurposeFirstParagraph(sections);

  return {
    absolutePath: overviewAbsolutePath,
    variant,
    firstLinePath,
    sections,
    missingRequiredSections,
    purposeFirstParagraph,
  };
}
