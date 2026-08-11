import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the branch-name exemption in `docs:links:check`.
 *
 * The branch-naming policy uses `<type>/<slug>`, and one of its types is `docs` — the
 * same prefix the docs link checker treats as a repo path. Documenting a branch example
 * (`docs/american-spelling-organization`) in inline code therefore read as a citation of
 * a missing file, and because `docs:links:check` runs only in `ci:quality` (the nightly
 * canary) and not PR CI, the docs PR that added those examples merged green and turned
 * `main` red.
 *
 * The checker now recognises the branch grammar. This test pins its type list to
 * `.husky/pre-push`, the policy's actual enforcer: if a type is added there and not
 * here, the same false positive returns for that prefix.
 */
const CHECKER_PATH = join(process.cwd(), 'src/scripts/validators/docs/check-docs-links.ts');
const PRE_PUSH_PATH = join(process.cwd(), '.husky/pre-push');

function branchTypesFromPrePush(source: string): string[] {
  const match = source.match(/^BRANCH_TYPES='([^']+)'/m);
  if (!match?.[1]) throw new Error('BRANCH_TYPES not found in .husky/pre-push');
  return match[1].split('|').sort();
}

function branchTypesFromChecker(source: string): string[] {
  const match = source.match(/const BRANCH_TYPES = \[([^\]]+)\]/);
  if (!match?.[1]) throw new Error('BRANCH_TYPES not found in check-docs-links.ts');
  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1] as string).sort();
}

describe('docs:links:check — branch-name exemption', () => {
  const checker = readFileSync(CHECKER_PATH, 'utf8');
  const prePush = readFileSync(PRE_PUSH_PATH, 'utf8');

  it('mirrors the branch types enforced by .husky/pre-push', () => {
    expect(branchTypesFromChecker(checker)).toEqual(branchTypesFromPrePush(prePush));
  });

  it('applies the branch-name guard when extracting a cited path', () => {
    expect(checker).toMatch(/if \(BRANCH_NAME_CITATION\.test\(token\)\) return null;/);
  });

  it('requires a multi-word kebab slug, so *.md citations stay checked', () => {
    // A dot cannot appear in the slug pattern, and the slug needs at least one hyphen —
    // single-word directories and every file citation remain subject to the existence check.
    expect(checker).toContain('[a-z0-9]+(?:-[a-z0-9]+)+$');
  });
});
