/** Domain policy test: subscription rows are an immutable ledger and must not be deleted. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const thisDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(thisDirectoryPath, '..', '..', '..', '..', '..');

describe('billing immutable ledger repositories', () => {
  it('must not use Drizzle .delete( on subscription rows', () => {
    const paths = ['src/domains/billing/sub-domains/subscription/subscription.repository.ts'];
    for (const relative of paths) {
      const absolute = path.join(projectRoot, relative);
      const source = readFileSync(absolute, 'utf8');
      expect(source, relative).not.toMatch(/\.delete\s*\(/);
    }
  });
});
