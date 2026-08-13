import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Structural policy gate for the whole k6 load suite.
 *
 * k6 scenarios only ever execute in the nightly workflow against an ephemeral stack, so nothing
 * in PR CI tells you a scenario has drifted: a scenario with no thresholds passes forever, one
 * wired to no runner is never executed at all, and a renamed file silently breaks the workflow
 * step that referenced it. The pre-existing `k6-coverage.policy` suite checks six gated scenarios;
 * this one holds the invariants that must be true of EVERY scenario, helper and preset.
 */

const ROOT = process.cwd();
const SCENARIOS_DIR = join(ROOT, 'src/tests/load/k6/scenarios');
const HELPERS_DIR = join(ROOT, 'src/tests/load/k6/helpers');
const WORKFLOW_PATH = join(ROOT, '.github/workflows/scheduled-k6-load-slo.yml');
const RUN_JOURNEY_PATH = join(ROOT, 'src/tests/load/k6/run-journey.sh');
const CONFIG_PATH = join(HELPERS_DIR, 'config.js');
const PACKAGE_JSON_PATH = join(ROOT, 'package.json');

const scenarioFiles = readdirSync(SCENARIOS_DIR)
  .filter((file) => file.endsWith('.js'))
  .sort();

const scenarioSource = new Map<string, string>(
  scenarioFiles.map((file) => [file, readFileSync(join(SCENARIOS_DIR, file), 'utf8')]),
);

const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
const runJourney = readFileSync(RUN_JOURNEY_PATH, 'utf8');
const packageJson = readFileSync(PACKAGE_JSON_PATH, 'utf8');
const config = readFileSync(CONFIG_PATH, 'utf8');

/** Scenarios reached through a wrapper rather than by filename. */
const INDIRECTLY_WIRED = new Set(['comprehensive-journey.js']);

describe('k6 scenario policy — every scenario', () => {
  it('has at least one scenario file (the suite is not silently empty)', () => {
    expect(scenarioFiles.length).toBeGreaterThan(20);
  });

  it.each(scenarioFiles)('%s exports an options object', (file) => {
    expect(scenarioSource.get(file)).toMatch(/export const options\s*=/);
  });

  it.each(scenarioFiles)('%s declares thresholds — without them a run can never fail', (file) => {
    // A k6 scenario with no thresholds always exits 0 no matter how slow or broken the API is,
    // so it contributes nothing to the nightly SLO signal while looking like coverage.
    expect(scenarioSource.get(file)).toMatch(/thresholds\s*:/);
  });

  it.each(scenarioFiles)('%s declares an executor (preset or explicit)', (file) => {
    const source = scenarioSource.get(file) ?? '';
    const usesPreset = /SCENARIOS\./.test(source);
    const usesExplicit = /executor\s*:/.test(source);

    expect(usesPreset || usesExplicit).toBe(true);
  });

  it.each(scenarioFiles)('%s exports a default entry point', (file) => {
    expect(scenarioSource.get(file)).toMatch(/export default/);
  });

  it.each(scenarioFiles)('%s takes its base URL from an overridable source', (file) => {
    const source = scenarioSource.get(file) ?? '';
    // The host must always be overridable by BASE_URL, whether the scenario imports the shared
    // helper or (like comprehensive-journey, which targets the dedicated :3001 load cluster that
    // setup-loadtest.sh starts) defines its own default. A host that ignores __ENV.BASE_URL would
    // silently point CI at the wrong server.
    const usesSharedConfig = /from '\.\.\/helpers\/config\.js'/.test(source);
    const readsBaseUrlEnvironment = /__ENV\.BASE_URL/.test(source);

    expect(
      usesSharedConfig || readsBaseUrlEnvironment,
      `${file} must import helpers/config.js or read __ENV.BASE_URL`,
    ).toBe(true);
  });

  it.each(scenarioFiles)('%s hardcodes no non-overridable host', (file) => {
    const source = scenarioSource.get(file) ?? '';
    const hosts = [...source.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1)[^'"`\s]*/g)];

    for (const [host] of hosts) {
      const line = source.split('\n').find((candidate) => candidate.includes(host)) ?? '';
      expect(line, `${file}: ${host} is not guarded by __ENV.BASE_URL`).toMatch(/__ENV\.BASE_URL/);
    }
  });

  it.each(scenarioFiles)('%s takes credentials from __ENV, never a literal', (file) => {
    const source = scenarioSource.get(file) ?? '';

    // Catches an inlined password/token/secret assigned to a string literal.
    expect(source).not.toMatch(/(password|secret|apiKey|api_key)\s*[:=]\s*['"][^'"]{6,}['"]/i);
    expect(source).not.toMatch(/Bearer\s+ey[A-Za-z0-9._-]+/);
  });

  it.each(scenarioFiles)('%s uses a kebab-case filename', (file) => {
    expect(file).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*\.js$/);
  });

  it.each(scenarioFiles)('%s tags its requests so per-route thresholds can bind', (file) => {
    const source = scenarioSource.get(file) ?? '';
    const declaresPerRouteThreshold = /'http_req_duration\{name:/.test(source);
    if (!declaresPerRouteThreshold) return;

    // A `{name:x}` threshold that no request carries as a tag is evaluated against an empty
    // series and passes vacuously — the exact failure this test exists to prevent.
    //
    // Scenarios that build tags dynamically (`const opts = (name) => ({ tags: { name } })`, as
    // api-stress.js does) cannot be resolved statically, so they are checked only for the
    // presence of a tag mechanism rather than name-by-name.
    const buildsTagsDynamically = /tags:\s*\{\s*name\s*[},]/.test(source);
    if (buildsTagsDynamically) {
      expect(source).toMatch(/tags:\s*\{/);
      return;
    }

    const taggedNames = [...source.matchAll(/tags:\s*\{\s*name:\s*'([^']+)'/g)].map(
      (match) => match[1],
    );
    const thresholdNames = [...source.matchAll(/'http_req_duration\{name:([^}]+)\}'/g)].map(
      (match) => match[1],
    );

    for (const name of thresholdNames) {
      expect(
        taggedNames,
        `${file}: threshold {name:${name}} has no matching request tag`,
      ).toContain(name);
    }
  });
});

describe('k6 scenario policy — wiring', () => {
  /** A scenario is reachable when some runner names its file. */
  function isWired(file: string): boolean {
    if (INDIRECTLY_WIRED.has(file)) return runJourney.length > 0;
    return (
      workflow.includes(`scenarios/${file}`) ||
      packageJson.includes(`scenarios/${file}`) ||
      runJourney.includes(file)
    );
  }

  it.each(scenarioFiles)(
    '%s is reachable from a runner (workflow, pnpm script or wrapper)',
    (file) => {
      // An unwired scenario is dead code that still costs review and maintenance: it is never
      // executed, so it never catches a regression and never fails when the API drifts under it.
      expect(isWired(file)).toBe(true);
    },
  );

  it('every scenario referenced by the nightly workflow exists on disk', () => {
    const referenced = [...workflow.matchAll(/scenarios\/([a-z0-9-]+\.js)/g)].map(
      (match) => match[1],
    );

    expect(referenced.length).toBeGreaterThan(0);
    for (const file of new Set(referenced)) {
      expect(scenarioFiles, `workflow references a missing scenario: ${file}`).toContain(file);
    }
  });

  it('every scenario referenced by a pnpm load script exists on disk', () => {
    const referenced = [...packageJson.matchAll(/scenarios\/([a-z0-9-]+\.js)/g)].map(
      (match) => match[1],
    );

    expect(referenced.length).toBeGreaterThan(0);
    for (const file of new Set(referenced)) {
      expect(scenarioFiles, `package.json references a missing scenario: ${file}`).toContain(file);
    }
  });

  it('the nightly workflow still enforces its SLO gate', () => {
    expect(workflow).toContain('Enforce gate success (SLO)');
    expect(workflow).toContain('id: gate');
  });
});

describe('k6 threshold presets (helpers/config.js)', () => {
  it.each([
    'THRESHOLDS',
    'SMOKE_THRESHOLDS',
    'STRICT_THRESHOLDS',
    'BREAKPOINT_THRESHOLDS',
    'SCENARIOS',
  ])('exports %s', (name) => {
    expect(config).toMatch(new RegExp(`export const ${name}\\s*=`));
  });

  it('every preset constrains BOTH latency and failure rate', () => {
    for (const preset of ['THRESHOLDS', 'SMOKE_THRESHOLDS', 'STRICT_THRESHOLDS']) {
      const block = config.slice(
        config.indexOf(`export const ${preset}`),
        config.indexOf('};', config.indexOf(`export const ${preset}`)),
      );
      expect(block, `${preset} must bound http_req_duration`).toContain('http_req_duration');
      expect(block, `${preset} must bound http_req_failed`).toContain('http_req_failed');
    }
  });

  it('SMOKE_THRESHOLDS sets no minimum throughput', () => {
    // Smoke runs at 1 VU, so a req/s floor would fail for reasons unrelated to system health.
    const block = config.slice(
      config.indexOf('export const SMOKE_THRESHOLDS'),
      config.indexOf('};', config.indexOf('export const SMOKE_THRESHOLDS')),
    );
    expect(block).not.toContain('http_reqs');
  });

  it('STRICT_THRESHOLDS is genuinely stricter than THRESHOLDS', () => {
    const p95 = (preset: string): number => {
      const block = config.slice(
        config.indexOf(`export const ${preset}`),
        config.indexOf('};', config.indexOf(`export const ${preset}`)),
      );
      const match = /p\(95\)<(\d+)/.exec(block);
      return Number(match?.[1] ?? Number.NaN);
    };

    expect(p95('STRICT_THRESHOLDS')).toBeLessThan(p95('THRESHOLDS'));
  });

  it('BREAKPOINT_THRESHOLDS aborts the ramp on breach', () => {
    const block = config.slice(
      config.indexOf('export const BREAKPOINT_THRESHOLDS'),
      config.indexOf('};', config.indexOf('export const BREAKPOINT_THRESHOLDS')),
    );
    // Without abortOnFail the ramp keeps hammering a saturated server and the reported
    // breaking point is meaningless.
    expect(block).toContain('abortOnFail: true');
    expect(block).toContain('delayAbortEval');
  });

  it.each(['smoke', 'load', 'stress', 'spike', 'soak', 'breakpoint'])(
    'SCENARIOS.%s declares an executor',
    (preset) => {
      const scenariosBlock = config.slice(config.indexOf('export const SCENARIOS'));
      const presetIndex = scenariosBlock.indexOf(`${preset}: {`);
      expect(presetIndex, `SCENARIOS.${preset} is missing`).toBeGreaterThan(-1);
      const block = scenariosBlock.slice(presetIndex, presetIndex + 400);
      expect(block).toContain('executor:');
    },
  );

  it('the breakpoint preset ramps arrival rate, not VUs', () => {
    const scenariosBlock = config.slice(config.indexOf('export const SCENARIOS'));
    const block = scenariosBlock.slice(scenariosBlock.indexOf('breakpoint: {'));
    // Arrival-rate keeps request throughput independent of how slow the server gets.
    expect(block).toContain('ramping-arrival-rate');
    expect(block).toContain('preAllocatedVUs');
  });
});

describe('k6 helpers', () => {
  const helperFiles = readdirSync(HELPERS_DIR).filter((file) => file.endsWith('.js'));

  it('ships the documented helper modules', () => {
    for (const helper of ['config.js', 'checks.js', 'auth.js', 'data.js', 'pool.js']) {
      expect(helperFiles).toContain(helper);
    }
  });

  it.each(['checkStatus', 'checkOk', 'checkResponseTime', 'checkJsonBody'])(
    'checks.js exports %s',
    (name) => {
      expect(readFileSync(join(HELPERS_DIR, 'checks.js'), 'utf8')).toMatch(
        new RegExp(`export function ${name}\\b`),
      );
    },
  );

  it.each(['login', 'switchToOrganization', 'switchToPersonal', 'authHeaders'])(
    'auth.js exports %s',
    (name) => {
      expect(readFileSync(join(HELPERS_DIR, 'auth.js'), 'utf8')).toMatch(
        new RegExp(`export function ${name}\\b`),
      );
    },
  );

  it.each(['mintTokenPool', 'vuToken'])('pool.js exports %s', (name) => {
    expect(readFileSync(join(HELPERS_DIR, 'pool.js'), 'utf8')).toMatch(
      new RegExp(`export function ${name}\\b`),
    );
  });

  it('pool.js fails loudly when the credential pool is absent', () => {
    const source = readFileSync(join(HELPERS_DIR, 'pool.js'), 'utf8');
    // Silently running with an empty pool would report a green run that tested nothing.
    expect(source).toContain('throw new Error');
    expect(source).toContain('db:seed:loadtest');
  });

  it('no helper hardcodes a base URL', () => {
    for (const helper of helperFiles) {
      const source = readFileSync(join(HELPERS_DIR, helper), 'utf8');
      if (helper === 'config.js') continue;
      expect(source, `${helper} must not hardcode a host`).not.toMatch(/https?:\/\/localhost/);
    }
  });
});

describe('k6 scenarios expecting non-2xx responses', () => {
  it.each([
    ['stripe-webhook-ingest.js', 'expectedStatuses(400)'],
    ['idempotency-storm.js', 'expectedStatuses(200, 201, 409, 422)'],
  ])('%s marks its expected statuses so k6 does not count them as failures', (file, expected) => {
    expect(scenarioSource.get(file)).toContain(expected);
  });

  it('every scenario asserting a 4xx status also declares a responseCallback', () => {
    for (const [file, source] of scenarioSource) {
      const assertsClientError = /checkStatus\([^,]+,\s*4\d\d/.test(source);
      if (!assertsClientError) continue;
      expect(source, `${file} asserts a 4xx but does not narrow http_req_failed`).toContain(
        'responseCallback',
      );
    }
  });
});
