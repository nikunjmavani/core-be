import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();

describe('Worker readiness (global)', () => {
  it('registers GET /livez and GET /readyz on the API process', () => {
    const healthMiddlewarePath = resolve(ROOT, 'src/shared/middlewares/health.middleware.ts');
    const content = readFileSync(healthMiddlewarePath, 'utf8');
    // Tolerate Biome line-wrapping when the route options object grows
    // large enough to force multi-line formatting (e.g. with a `schema:` block).
    expect(content).toMatch(/application\.get\(\s*['"]\/livez['"]/);
    expect(content).toMatch(/application\.get\(\s*['"]\/readyz['"]/);
  });

  it('worker HTTP server serves GET /livez and GET /readyz with queue heartbeats', () => {
    const workerHealthServerPath = resolve(
      ROOT,
      'src/infrastructure/queue/worker-runtime/worker-health.server.ts',
    );
    const content = readFileSync(workerHealthServerPath, 'utf8');
    expect(content).toContain('/livez');
    expect(content).toContain('/readyz');
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

  it('deploy workflow probes API health and relies on Railway terminal status for the worker', () => {
    const workflowPath = resolve(ROOT, '.github/workflows/reusable-railway-deploy.yml');
    const workflow = readFileSync(workflowPath, 'utf8');
    expect(workflow).toContain('Deploy API and worker to Railway');
    expect(workflow).toContain('wait_for_service_health()');
    // biome-ignore lint/suspicious/noTemplateCurlyInString: literal bash variable in the workflow YAML — not a TS template.
    expect(workflow).toContain('${base_url}/readyz');
    expect(workflow).toContain(
      'deploy_service_from_image "$RAILWAY_SERVICE_ID" "$API_IMAGE" "api"',
    );
    expect(workflow).toContain(
      'deploy_service_from_image "$RAILWAY_WORKER_SERVICE_ID" "$WORKER_IMAGE" "worker"',
    );

    // Worker readiness must NOT be probed from the GitHub runner. Railway's
    // private network (`*.railway.internal` Postgres + Redis) is unreachable
    // from public GitHub Actions hosts, and the worker service has no public
    // Railway domain. The deployment terminal SUCCESS — driven by the in-pod
    // HEALTHCHECK in `Dockerfile.worker` — is the only reliable post-deploy
    // worker gate, complemented by the post-deploy API smoke that exercises
    // worker-backed paths.
    expect(workflow).not.toContain('Probe worker readiness');
    expect(workflow).not.toContain('Check worker readiness');
    expect(workflow).not.toContain('pnpm tool:worker-readiness');
    expect(workflow).not.toContain('wait_for_service_health "$worker_base_url"');
  });

  it('post-deploy worker readiness script supports redis-direct mode (local ops)', () => {
    // The script is no longer invoked from CI (Railway private network is
    // unreachable from GitHub runners), but it remains available for local
    // dev / on-call engineers running it from inside the Railway network or
    // via `railway run pnpm tool:worker-readiness`.
    const scriptPath = resolve(ROOT, 'src/scripts/admin/worker-readiness.ts');
    const content = readFileSync(scriptPath, 'utf8');
    expect(content).toContain('readWorkerQueueHeartbeats');
    expect(content).toContain('WORKER_THROUGHPUT_QUEUE_NAMES');
    expect(content).toContain('getTotalDeadLetterJobCount');
    expect(content).toContain('runDependencyReadinessProbes');
    expect(content).toContain('/readyz');
  });
});
