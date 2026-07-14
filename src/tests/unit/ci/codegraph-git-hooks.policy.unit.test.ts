import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

/**
 * Locks in the codegraph auto-sync git hooks: `codegraph sync` is a local,
 * incremental index refresh (no LLM tokens) that must run on the events which
 * change the working tree — branch switches (post-checkout) and merges/pulls
 * (post-merge) — so code-intelligence queries never answer from a stale index.
 * Both must be guarded (no-op when codegraph or the index is absent, e.g. CI /
 * web sessions) and backgrounded (never block the git command).
 */
describe('codegraph auto-sync git hooks policy', () => {
  it('post-checkout refreshes the index on a branch switch — guarded + backgrounded', () => {
    const hook = readFileSync(join(ROOT, '.husky/post-checkout'), 'utf8');
    expect(hook).toContain('codegraph sync');
    // only branch checkouts ($3 == 1), not file checkouts
    expect(hook).toContain('[ "$3" = "1" ]');
    // no-op when codegraph or the index is absent (CI, web sessions)
    expect(hook).toContain('command -v codegraph');
    expect(hook).toContain('.codegraph/codegraph.db');
    // backgrounded so it never blocks the checkout
    expect(hook).toContain('&');
  });

  it('post-merge refreshes the index after a merge/pull — guarded + backgrounded', () => {
    const hook = readFileSync(join(ROOT, '.husky/post-merge'), 'utf8');
    expect(hook).toContain('codegraph sync');
    expect(hook).toContain('command -v codegraph');
    expect(hook).toContain('.codegraph/codegraph.db');
    expect(hook).toContain('&');
  });
});
