/**
 * Parser for `.env.example` and its `.env.<environment>` siblings.
 *
 * The structure encodes Secret-vs-Variable classification: each file has
 * exactly two top-level halves (`# ###...###` triplets) — "GitHub Secrets"
 * and "GitHub Variables" — and each half contains sub-sections marked with
 * `# ---...---` triplets.
 *
 *   # ############################################################
 *   # GitHub Secrets (pushed via `gh secret set`)
 *   # ############################################################
 *
 *   # --- Database (Postgres) ---
 *   DATABASE_URL=postgresql://...
 *
 *   # ############################################################
 *   # GitHub Variables (pushed via `gh api .../variables`)
 *   # ############################################################
 *
 *   # --- Server & process ---
 *   PORT=3000
 *
 * Parsing rules:
 *   - Top-level header: a `# #...#` line, followed by `# Title ...`,
 *     followed by another `# #...#` line.
 *   - Sub-section header: same pattern but with `-` separators.
 *   - Variables are recognized as `KEY=VALUE` (commented lines are skipped).
 *   - Multi-line double-quoted values (PEM keys) are reassembled correctly.
 *
 * Both `tooling/setup/github/sync-config.ts` (template → `.env.<env>`) and
 * `tooling/setup/envs/sync-github.ts` (push to GitHub) read this structure,
 * so the file IS the source of truth for classification — no separate rules
 * file, no override lists, no `classifyEnvKey()` function.
 */

import { readFileSync } from 'node:fs';

export interface EnvExampleKey {
  readonly name: string;
  readonly value: string;
}

export interface EnvExampleSubSection {
  readonly title: string;
  readonly keys: EnvExampleKey[];
}

export interface EnvExampleSection {
  readonly title: string;
  readonly classification: 'secret' | 'variable';
  readonly subSections: EnvExampleSubSection[];
}

export interface ParsedEnvExample {
  readonly secrets: EnvExampleSection;
  readonly variables: EnvExampleSection;
}

const HALF_SEPARATOR = /^#\s#{3,}\s*$/;
const SUBSECTION_SEPARATOR = /^#\s-{3,}\s*$/;
const TITLE_LINE = /^#\s+(.+?)\s*$/;
const VARIABLE_LINE = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;

function classifyHalfTitle(title: string): 'secret' | 'variable' | null {
  const normalized = title.toLowerCase();
  if (normalized.includes('github secrets')) return 'secret';
  if (normalized.includes('github variables')) return 'variable';
  return null;
}

export function parseEnvExampleSections(filePath: string): ParsedEnvExample {
  const lines = readFileSync(filePath, 'utf-8').split('\n');

  let currentHalf: 'secret' | 'variable' | null = null;
  const halves: Record<'secret' | 'variable', EnvExampleSection> = {
    secret: { title: 'GitHub Secrets', classification: 'secret', subSections: [] },
    variable: { title: 'GitHub Variables', classification: 'variable', subSections: [] },
  };
  let currentSubSection: EnvExampleSubSection | null = null;

  function ensureSubSection(): EnvExampleSubSection {
    if (currentHalf === null) {
      throw new Error(
        `Found a KEY=VALUE line outside any top-level "# GitHub Secrets" / "# GitHub Variables" header in ${filePath}.`,
      );
    }
    if (currentSubSection !== null) return currentSubSection;
    const placeholder: EnvExampleSubSection = { title: 'Misc', keys: [] };
    halves[currentHalf].subSections.push(placeholder);
    currentSubSection = placeholder;
    return placeholder;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';

    if (HALF_SEPARATOR.test(line)) {
      const titleLine = lines[index + 1] ?? '';
      const closingLine = lines[index + 2] ?? '';
      const titleMatch = titleLine.match(TITLE_LINE);
      if (titleMatch && HALF_SEPARATOR.test(closingLine)) {
        const titleCapture = titleMatch[1] ?? '';
        const newHalf = classifyHalfTitle(titleCapture);
        if (newHalf === null) {
          throw new Error(
            `Unknown top-level section header "${titleCapture}" in ${filePath}. Expected "GitHub Secrets" or "GitHub Variables".`,
          );
        }
        currentHalf = newHalf;
        currentSubSection = null;
        index += 2;
        continue;
      }
    }

    if (SUBSECTION_SEPARATOR.test(line)) {
      const titleLine = lines[index + 1] ?? '';
      const closingLine = lines[index + 2] ?? '';
      const titleMatch = titleLine.match(TITLE_LINE);
      if (titleMatch && SUBSECTION_SEPARATOR.test(closingLine)) {
        if (currentHalf === null) {
          throw new Error(
            `Sub-section "${titleMatch[1]}" appears before any top-level header in ${filePath}.`,
          );
        }
        const subSection: EnvExampleSubSection = { title: titleMatch[1]?.trim(), keys: [] };
        halves[currentHalf].subSections.push(subSection);
        currentSubSection = subSection;
        index += 2;
        continue;
      }
    }

    if (line.startsWith('#') || line.trim() === '') continue;

    const varMatch = line.match(VARIABLE_LINE);
    if (!varMatch) continue;

    const name = varMatch[1] ?? '';
    let value = varMatch[2] ?? '';
    if (!name) continue;
    if (value.startsWith('"')) {
      let collected = value.slice(1);
      while (!collected.endsWith('"')) {
        index += 1;
        if (index >= lines.length) break;
        collected += `\n${lines[index] ?? ''}`;
      }
      value = collected.endsWith('"') ? collected.slice(0, -1) : collected;
      // Resolve `\n` escapes inside double-quoted values so PEM keypairs round-trip
      // cleanly when an operator writes them on a single line.
      value = value.replace(/\\n/g, '\n');
    }

    ensureSubSection().keys.push({ name, value });
  }

  if (halves.secret.subSections.length === 0) {
    throw new Error(
      `${filePath} has no "# GitHub Secrets" half. The file structure is the source of truth for classification — both halves are required.`,
    );
  }
  if (halves.variable.subSections.length === 0) {
    throw new Error(
      `${filePath} has no "# GitHub Variables" half. The file structure is the source of truth for classification — both halves are required.`,
    );
  }

  return { secrets: halves.secret, variables: halves.variable };
}
