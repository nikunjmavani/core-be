import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const POST_MERGE_WORKFLOW = join(ROOT, '.github/workflows/post-merge-ci.yml');

describe('post-merge CI trigger policy', () => {
  it('runs only after a merged PR into dev or main (plus manual dispatch)', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).toContain('pull_request:');
    expect(workflow).toContain('types: [closed]');
    expect(workflow).toContain('branches: [main, dev]');
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('github.event.pull_request.merged == true');
    expect(workflow).not.toMatch(/^\s+push:\s*$/m);
  });

  it('does not run full DB integration or chaos matrices in CI', () => {
    const workflow = readFileSync(POST_MERGE_WORKFLOW, 'utf8');
    expect(workflow).not.toContain('reusable-vitest-postgres-redis.yml');
    expect(workflow).not.toContain('reusable-chaos-toxiproxy.yml');
    expect(workflow).not.toMatch(/^\s+integration-tests:/m);
    expect(workflow).not.toMatch(/^\s+chaos:/m);
  });
});
