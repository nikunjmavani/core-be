import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

describe('Worker readiness (global)', () => {
  it('registers GET /health on the API process', () => {
    const healthMiddlewarePath = resolve(ROOT, 'src/shared/middlewares/health.middleware.ts');
    const content = readFileSync(healthMiddlewarePath, 'utf8');
    expect(content).toContain("application.get('/health'");
  });

  it('worker HTTP server serves GET /health with queue heartbeats', () => {
    const workerHealthServerPath = resolve(
      ROOT,
      'src/infrastructure/queue/worker-runtime/worker-health.server.ts',
    );
    const content = readFileSync(workerHealthServerPath, 'utf8');
    expect(content).toContain('/health');
    expect(content).toContain('readWorkerQueueHeartbeats');
  });

  it('deploy workflow fails when RAILWAY_WORKER_SERVICE_ID is unset', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/reusable-railway-deploy.yml');
    expect(existsSync(workflowPath)).toBe(true);
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('RAILWAY_WORKER_SERVICE_ID must be set in this GitHub environment');
    expect(workflow).not.toContain('Skipping worker deploy');
  });

  it('deploy workflow prefers redeploy and only falls back to railway up for an initial bootstrap', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/reusable-railway-deploy.yml');
    const workflow = readFileSync(workflowPath, 'utf8');

    expect(workflow).toContain('railway redeploy --service');
    expect(workflow).toContain('Log expected scanned CI image refs from GHCR');
    expect(workflow).not.toContain('run: pnpm build');

    // `railway up` is allowed as the conditional fallback for services with no
    // prior deployment, but it must be gated by the Railway "No deployment
    // found for service" error so the workflow never bypasses redeploy in
    // steady state.
    expect(workflow).toContain('no deployment found for service');
    expect(workflow).toContain('railway up --service');
    expect(workflow.indexOf('no deployment found for service')).toBeLessThan(
      workflow.indexOf('railway up --service'),
    );
  });

  it('deploy workflow probes API and worker health after redeploy', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/reusable-railway-deploy.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('Post-deploy API health check');
    expect(workflow).toContain('$api_base_url/health');
    expect(workflow).toContain('Post-deploy worker health check');
    expect(workflow).toContain('pnpm tool:worker-readiness --url "$WORKER_HEALTH_URL"');
  });

  it('post-deploy worker readiness script probes /health', () => {
    const scriptPath = resolve(ROOT, 'src/scripts/admin/worker-readiness.ts');
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('/health');
  });
});
