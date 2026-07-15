import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * sec-r5-secret-scanning: prevent future commits from introducing
 * Stripe-prefixed literals (`sk_live_`, `sk_test_`, `whsec_`) into committed
 * source. GitHub Secret Scanning matches by raw regex against the source text
 * — it cannot distinguish a unit-test fixture / OpenAPI placeholder from a
 * leaked production secret. Once a `whsec_aaa…` appears in source, every push
 * triggers an alert and the only practical fix is a refactor.
 *
 * Each justified mention of the prefix lives at a known location (operator
 * docs, runtime prefix sniff, etc.) and is allowlisted in
 * `JUSTIFIED_MENTIONS` below — adding a new entry requires explaining why
 * the prefix is necessary.
 *
 * Scope: `src/**` and `tooling/**` (excluding test snapshots / generated docs).
 * Filenames / test files are ALSO scanned — the rule is "no shipping a
 * literal that matches a real Stripe regex," and test files ship to the
 * customer-visible repo just like everything else.
 */
describe('Global: no Stripe-shaped literals in source (sec-r5-secret-scanning)', () => {
  /**
   * Patterns chosen to match GitHub Secret Scanning's Stripe rules:
   *
   * - `sk_live_[a-zA-Z0-9]{16,}` — production Stripe API key
   * - `sk_test_[a-zA-Z0-9]{16,}` — Stripe test-mode API key (still scanner-flagged in some rulesets)
   * - `whsec_[a-zA-Z0-9_-]{16,}` — Stripe webhook signing secret
   *
   * The threshold (16+ chars in body) is intentionally below Stripe's real
   * minimum (20+) so we catch the placeholders early — well before they reach
   * the length that triggers GH alerts.
   */
  const STRIPE_LITERAL_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
    { name: 'sk_live_<key>', pattern: /\bsk_live_[a-zA-Z0-9]{16,}\b/g },
    { name: 'sk_test_<key>', pattern: /\bsk_test_[a-zA-Z0-9]{16,}\b/g },
    { name: 'whsec_<key>', pattern: /\bwhsec_[a-zA-Z0-9_-]{16,}\b/g },
  ];

  /**
   * File paths where mentioning a real Stripe prefix is intentional and
   * required by the application logic (runtime prefix sniff, operator
   * setup guide, this test itself). Adding to this list requires a comment
   * justifying WHY the real prefix has to appear in source.
   */
  const JUSTIFIED_MENTIONS = new Set<string>([
    // Test itself — the regex source has to include the prefix it's matching.
    'src/tests/global/no-stripe-shaped-literals.global.test.ts',
    // Env-schema validates input format at runtime; tests assert that
    // validation rejects malformed values (short-body placeholders below
    // the 16-char threshold of this test, so the patterns wouldn't trip
    // anyway, but listed explicitly).
    'src/tests/unit/config/env-schema.unit.test.ts',
    'src/shared/config/env-schema.ts',
    // The whsec-prefix appears only as a doc string ("a comma-separated
    // list of whsec_-prefixed secrets") with no body characters. Won't trip
    // the 16+-char body threshold anyway; listed for explicitness.
    'src/domains/billing/sub-domains/stripe-webhook/__tests__/unit/stripe-webhook-construct-event.unit.test.ts',
    // The contract-setup placeholder ships a long, English-prose-shaped
    // string after the prefix (e.g. whsec_test_contract_fixture_…). The
    // env-schema (`src/shared/config/env-schema.ts`) validates the
    // STRIPE_WEBHOOK_SECRET / STRIPE_SECRET_KEY values match the real Stripe
    // prefixes — these test files set process.env BEFORE the schema parses,
    // so the prefix MUST appear in source to satisfy the validator. The
    // recognisable English text inside the body causes GitHub's entropy
    // scanner to skip these (verified — no GH alert on these specific
    // strings). Listed explicitly so any future change is reviewed.
    'src/tests/setup.ts',
    'src/tests/chaos/bootstrap-env.ts',
  ]);

  const ROOTS = ['src', 'tooling'] as const;
  const SKIP_EXTENSIONS = new Set<string>([
    '.json',
    '.snap',
    '.lock',
    '.md',
    '.txt',
    '.svg',
    '.png',
    '.jpg',
    '.ico',
  ]);
  const SKIP_DIRECTORIES = new Set<string>([
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.git',
    '__snapshots__',
  ]);

  async function* walkSourceFiles(directory: string): AsyncGenerator<string> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        yield* walkSourceFiles(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const dotIndex = entry.name.lastIndexOf('.');
      const extension = dotIndex === -1 ? '' : entry.name.slice(dotIndex);
      if (SKIP_EXTENSIONS.has(extension)) continue;
      yield entryPath;
    }
  }

  it('contains no Stripe-shaped literals outside the justified allowlist', async () => {
    const repositoryRoot = process.cwd();
    const violations: string[] = [];

    for (const root of ROOTS) {
      const absoluteRoot = join(repositoryRoot, root);
      for await (const absolutePath of walkSourceFiles(absoluteRoot)) {
        const relativePath = absolutePath.slice(repositoryRoot.length + 1);
        if (JUSTIFIED_MENTIONS.has(relativePath)) continue;
        const fileText = await fs.readFile(absolutePath, 'utf8');
        for (const { name, pattern } of STRIPE_LITERAL_PATTERNS) {
          // Reset pattern's lastIndex because the regex is `g`-flagged.
          pattern.lastIndex = 0;
          const matches = fileText.match(pattern);
          if (matches && matches.length > 0) {
            violations.push(
              `  ${relativePath} — pattern ${name} matched ${matches.length}× (first: ${matches[0]})`,
            );
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found Stripe-shaped literal(s) in committed source. These match GitHub Secret Scanning rules and would trigger alerts on push:\n${violations.join('\n')}\n\nFix: replace the literal with an opaque value (e.g. 'STRIPE_TEST_KEY_PLACEHOLDER', '<api-key-shown-once>') OR add the file to JUSTIFIED_MENTIONS with a comment explaining WHY the prefix must appear.`,
      );
    }
    expect(violations).toEqual([]);
  });
});
