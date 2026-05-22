import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

describe('Worker readiness (global)', () => {
  it('registers GET /health/worker on the API process', () => {
    const healthMiddlewarePath = resolve(ROOT, 'src/shared/middlewares/health.middleware.ts');
    const content = readFileSync(healthMiddlewarePath, 'utf8');
    expect(content).toContain("application.get('/health/worker'");
  });

  it('worker HTTP server serves GET /health/worker with queue heartbeats', () => {
    const workerHealthServerPath = resolve(
      ROOT,
      'src/infrastructure/queue/worker-runtime/worker-health.server.ts',
    );
    const content = readFileSync(workerHealthServerPath, 'utf8');
    expect(content).toContain('/health/worker');
    expect(content).toContain('readWorkerQueueHeartbeats');
  });

  it('deploy workflow fails when RAILWAY_WORKER_SERVICE_ID is unset', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/deploy-railway-after-ci.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('RAILWAY_WORKER_SERVICE_ID must be set in this GitHub environment');
    expect(workflow).not.toContain('Skipping worker deploy');
  });

  it('deploy workflow uses scanned CI images only (no source build or railway up)', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/deploy-railway-after-ci.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('railway redeploy --service');
    expect(workflow).toContain('Resolve scanned CI images from GHCR');
    expect(workflow).not.toContain('run: pnpm build');
    expect(workflow).not.toContain('railway up --service');
  });

  it('post-deploy worker readiness script probes /health/worker', () => {
    const scriptPath = resolve(ROOT, 'src/scripts/admin/worker-readiness.ts');
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('/health/worker');
  });
});
