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
    expect(workflow).toContain('--service "$service"');
    expect(workflow).toContain('--image "$image"');
    expect(workflow).toContain('--label "$label"');

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

  it('deploy workflow probes API health and runs worker-readiness after deploy', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/reusable-railway-deploy.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('Deploy API and worker to Railway');
    expect(workflow).toContain('wait_for_service_health()');
    expect(workflow).toContain('${base_url}/health');
    expect(workflow).toContain(
      'deploy_service_from_image "$RAILWAY_SERVICE_ID" "$API_IMAGE" "api"',
    );
    expect(workflow).toContain(
      'deploy_service_from_image "$RAILWAY_WORKER_SERVICE_ID" "$WORKER_IMAGE" "worker"',
    );

    // Worker readiness goes through pnpm tool:worker-readiness because the
    // worker has no public Railway domain to curl /health on.
    expect(workflow).toContain('Probe worker readiness');
    expect(workflow).toContain('pnpm tool:worker-readiness');
    expect(workflow).not.toContain('wait_for_service_health "$worker_base_url"');
  });

  it('post-deploy worker readiness script supports redis-direct mode', () => {
    const scriptPath = resolve(ROOT, 'src/scripts/admin/worker-readiness.ts');
    const content = readFileSync(scriptPath, 'utf8');
    // Redis-direct path (default) — verifies DLQ depth + heartbeats without
    // requiring a public worker /health endpoint.
    expect(content).toContain('readWorkerQueueHeartbeats');
    expect(content).toContain('WORKER_THROUGHPUT_QUEUE_NAMES');
    expect(content).toContain('getTotalDeadLetterJobCount');
    expect(content).toContain('runDependencyReadinessProbes');
    // HTTP fallback path retained for environments that do expose worker /health.
    expect(content).toContain('/health');
  });
});
