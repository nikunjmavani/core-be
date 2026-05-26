import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

describe('restore drill automation policy', () => {
  it('does not ship a manual RTO record workflow or legacy URL fallback', () => {
    expect(existsSync(join(ROOT, '.github/workflows/manual-dr-rto-record.yml'))).toBe(false);

    const workflow = readFileSync(
      join(ROOT, '.github/workflows/scheduled-monthly-restore-rto.yml'),
      'utf8',
    );
    expect(workflow).not.toContain('DATABASE_URL_FOR_MONTHLY_RESTORE_DRILL');
    expect(workflow).not.toContain('recorded_rto_minutes');
  });

  it('uses monthly drill Neon secrets and workflow ref as parent branch', () => {
    const workflow = readFileSync(
      join(ROOT, '.github/workflows/scheduled-monthly-restore-rto.yml'),
      'utf8',
    );
    const script = readFileSync(join(ROOT, 'tooling/ci/restore-drill-neon.sh'), 'utf8');

    expect(workflow).toContain('MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY');
    expect(workflow).toContain('MONTHLY_DATABASE_RESTORE_DRILL_NEON_PROJECT_ID');
    expect(workflow).toContain('RESTORE_DRILL_PARENT_BRANCH_NAME: ${{ github.ref_name }}');
    expect(workflow).toContain('environment: ${{ needs.resolve-environment.outputs.environment }}');
    expect(workflow).toContain('tooling/ci/restore-drill-neon.sh create');
    expect(workflow).toContain('tooling/ci/restore-drill-neon.sh delete');

    expect(script).toContain('MONTHLY_DATABASE_RESTORE_DRILL_NEON_API_KEY');
    expect(script).toContain('MONTHLY_DATABASE_RESTORE_DRILL_NEON_PROJECT_ID');
    expect(script).toContain('RESTORE_DRILL_PARENT_BRANCH_NAME');
    expect(script).not.toContain('NEON_PARENT_BRANCH_ID');
    expect(script).not.toContain('DATABASE_URL_FOR_MONTHLY');
  });
});
