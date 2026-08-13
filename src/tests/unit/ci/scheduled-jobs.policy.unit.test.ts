import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Registry gate for the scheduled (cron) GitHub workflows.
 *
 * Scheduled workflows are the least-observed code in the repo: nobody watches a 03:00 Sunday run,
 * and a broken one fails silently for weeks because no PR is ever red because of it. They are
 * also the ones that most need guard rails — they run unattended, on a shared runner pool, often
 * against real infrastructure (the restore drills, the k6 load stack, the canary).
 *
 * The BullMQ side of scheduling is already covered by `scheduler.unit.test.ts` and
 * `scheduler-registry-audit`; this pins the GitHub-Actions half, which had nothing.
 *
 * Ported from the sibling frontend repository's `scheduled-jobs.policy` suite, which this
 * repository had no equivalent of.
 */

const ROOT = process.cwd();
const WORKFLOW_DIRECTORY = join(ROOT, '.github/workflows');

const scheduledFiles = readdirSync(WORKFLOW_DIRECTORY)
  .filter((name) => name.startsWith('scheduled-') && name.endsWith('.yml'))
  .sort();

const source = new Map<string, string>(
  scheduledFiles.map((file) => [file, readFileSync(join(WORKFLOW_DIRECTORY, file), 'utf8')]),
);

function cronsOf(workflow: string): string[] {
  return [...workflow.matchAll(/cron:\s*'([^']+)'/g)].map((match) => match[1] as string);
}

describe('scheduled workflow registry', () => {
  it('finds the scheduled workflows (the glob is not silently empty)', () => {
    expect(scheduledFiles.length).toBeGreaterThanOrEqual(7);
  });

  it.each(scheduledFiles)('%s declares a schedule trigger', (file) => {
    expect(source.get(file)).toMatch(/on:[\s\S]*schedule:/);
    expect(cronsOf(source.get(file) ?? '').length).toBeGreaterThan(0);
  });

  it.each(scheduledFiles)('%s declares a valid 5-field cron', (file) => {
    for (const cron of cronsOf(source.get(file) ?? '')) {
      expect(cron.trim().split(/\s+/), `${file}: "${cron}" is not a 5-field cron`).toHaveLength(5);
    }
  });

  it.each(scheduledFiles)('%s can be triggered manually', (file) => {
    // Without workflow_dispatch the only way to exercise a nightly job is to wait for the cron
    // or push a temporary schedule change — so it never gets tested after a fix.
    expect(source.get(file)).toContain('workflow_dispatch');
  });

  it.each(scheduledFiles)('%s declares a concurrency group', (file) => {
    // A long run overlapping the next tick doubles load on shared infrastructure and, for the
    // restore drills, can point two jobs at the same target at once.
    expect(source.get(file)).toContain('concurrency:');
  });

  it.each(scheduledFiles)('%s bounds every job with timeout-minutes', (file) => {
    // An unattended job with no timeout burns runner minutes until the 6h platform default.
    expect(source.get(file)).toContain('timeout-minutes:');
  });

  it.each(scheduledFiles)('%s declares explicit permissions (least privilege)', (file) => {
    // Omitting the block inherits the repository-level default token scope rather than stating
    // what the job actually needs — the standard GitHub Actions hardening rule.
    expect(source.get(file)).toMatch(/^permissions:/m);
  });

  it('no two scheduled workflows share an identical cron', () => {
    const byCron = new Map<string, string[]>();
    for (const [file, workflow] of source) {
      for (const cron of cronsOf(workflow)) {
        byCron.set(cron, [...(byCron.get(cron) ?? []), file]);
      }
    }

    const collisions = [...byCron.entries()]
      .filter(([, files]) => files.length > 1)
      .map(([cron, files]) => `${cron} → ${files.join(', ')}`);

    // Identical crons start together on the same shared runner pool and contend for the same
    // ephemeral Postgres/Redis services.
    expect(collisions, 'scheduled workflows must be staggered').toEqual([]);
  });

  it('every scheduled workflow name is discoverable from its filename', () => {
    for (const [file, workflow] of source) {
      expect(workflow, `${file} must declare a top-level name:`).toMatch(/^name:\s*\S/m);
    }
  });
});
