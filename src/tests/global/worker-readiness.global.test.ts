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

  it('deploy workflow deploys the freshly built GHCR image via tool:railway-deploy-image', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/reusable-railway-deploy.yml');
    const workflow = readFileSync(workflowPath, 'utf8');

    // The deploy job MUST go through the Railway GraphQL API tool, which
    // pins the service to the freshly built GHCR image and creates a new
    // deployment from it. The Railway CLI alternatives are forbidden here:
    //   - `railway redeploy` re-runs the previous deployment object with
    //     its existing image tag, so it silently serves the OLD image.
    //   - `railway up` uploads the runner's source for Railway to build,
    //     bypassing the scanned GHCR image entirely.
    expect(workflow).toContain('Log expected scanned CI image refs from GHCR');
    expect(workflow).toContain('pnpm tool:railway-deploy-image');
    expect(workflow).toContain('--service "$RAILWAY_SERVICE_ID"');
    expect(workflow).toContain('--service "$RAILWAY_WORKER_SERVICE_ID"');
    expect(workflow).toContain('--image "$API_IMAGE"');
    expect(workflow).toContain('--image "$WORKER_IMAGE"');
    expect(workflow).toContain('--label api');
    expect(workflow).toContain('--label worker');

    expect(workflow).not.toContain('railway redeploy');
    expect(workflow).not.toContain('railway up --service');
    expect(workflow).not.toContain('run: pnpm build');

    const deployImageToolPath = resolve(ROOT, 'tooling/setup/railway/deploy-image.ts');
    const deployImageTool = readFileSync(deployImageToolPath, 'utf8');
    expect(deployImageTool).toContain('Project-Access-Token');
    expect(deployImageTool).toContain('projectToken');
    expect(deployImageTool).toContain('serviceInstanceUpdate');
    expect(deployImageTool).toContain('serviceInstanceDeployV2');
  });

  it('deploy workflow probes API and worker health after deploy', () => {
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
