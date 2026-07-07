/**
 * Labeled pre-commit guard — same steps as `.husky/pre-commit`, fail-fast with step names.
 * Run: `pnpm guard:pre-commit` or `pnpm guard:pre-commit:list`
 */
import { execSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROUTES_CATALOG_PATH = 'docs/routes.txt';
const SRC_STRUCTURE_TREE_PATH = 'docs/reference/architecture/src-structure-tree.txt';
const DBML_PATH = 'docs/database/core-be.dbml';
const ONE_MEGABYTE = 1048576;

/** One labeled step in the pre-commit guard sequence. */
export interface GuardStep {
  id: string;
  label: string;
  when: 'always' | 'conditional';
  description: string;
}

/** Options for {@link runPreCommitGuard} — used by tests to stub staged files and scripts. */
export interface RunGuardOptions {
  listOnly?: boolean;
  stagedFiles?: string[];
  packageScripts?: Record<string, string>;
  skipShellSteps?: boolean;
}

function readPackageScripts(): Record<string, string> {
  const packageJsonPath = join(process.cwd(), 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>;
  };
  return packageJson.scripts ?? {};
}

/** Returns paths currently staged for commit (`git diff --cached --name-only`). */
export function getStagedFiles(): string[] {
  try {
    const output = execSync('git diff --cached --name-only', { encoding: 'utf8' });
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return [];
  }
}

/** Returns whether `package.json` defines the given npm script name. */
export function hasPackageScript(scripts: Record<string, string>, scriptName: string): boolean {
  return typeof scripts[scriptName] === 'string';
}

/** Returns whether staged files touch OpenAPI route or generator sources. */
export function shouldRunOpenApiCheck(stagedFiles: string[]): boolean {
  const openApiPatterns = [
    /^src\/domains\/.*\.routes\.ts$/,
    /^src\/shared\/locales\/.*\/openapi\.json$/,
    /^tooling\/openapi\//,
    /^src\/scripts\/codegen\/generate-openapi\.ts$/,
    /^src\/scripts\/codegen\/openapi-/,
    /^src\/scripts\/codegen\/check-api-docs-sync\.ts$/,
  ];
  return stagedFiles.some((file) => openApiPatterns.some((pattern) => pattern.test(file)));
}

/** Returns whether staged files include SQL migrations. */
export function shouldRunMigrationCheck(stagedFiles: string[]): boolean {
  return stagedFiles.some((file) => /^migrations\/.*\.sql$/.test(file));
}

/** Returns whether staged files touch `src/` or `tooling/` (structure tree drift). */
export function shouldRunStructureTreeCheck(stagedFiles: string[]): boolean {
  return stagedFiles.some((file) => file.startsWith('src/') || file.startsWith('tooling/'));
}

/** Returns whether staged files include domain TypeScript files (controllers, services, workers, any domain layer). */
export function shouldRunGlobalTests(stagedFiles: string[]): boolean {
  return stagedFiles.some(
    (file) =>
      (file.startsWith('src/domains/') && file.endsWith('.ts')) ||
      // env-driven-config guard (no-nodeenv-branching.global.test.ts) scans the schema, the test
      // harness, the CI workflows, and the Docker files — trigger the global suite when they change.
      file === 'src/shared/config/env-schema.ts' ||
      file === 'src/tests/setup.ts' ||
      file === 'src/tests/chaos/bootstrap-env.ts' ||
      file.startsWith('.github/workflows/') ||
      file === 'Dockerfile' ||
      file === 'Dockerfile.worker' ||
      file === 'docker-compose.yml',
  );
}

/**
 * Returns whether staged files include deployed-surface runtime code that SonarQube analyzes —
 * `src/**\/*.ts` excluding tests (`__tests__/`, `*.test.ts`, `*.spec.ts`, `src/tests/`) and
 * `src/scripts/`. Mirrors the scoping in `sonar-project.properties`.
 */
export function shouldRunSonarScan(stagedFiles: string[]): boolean {
  return stagedFiles.some(
    (file) =>
      /^src\/.*\.ts$/.test(file) &&
      !/(__tests__\/|\.test\.ts$|\.spec\.ts$|^src\/tests\/|^src\/scripts\/)/.test(file),
  );
}

function runPnpm(scriptName: string, scriptArgs: string[] = []): number {
  const result = spawnSync('pnpm', [scriptName, ...scriptArgs], { stdio: 'inherit', shell: false });
  return result.status ?? 1;
}

function runShell(command: string): number {
  const result = spawnSync(command, { stdio: 'inherit', shell: true });
  return result.status ?? 1;
}

function gitAdd(paths: string[]): void {
  if (paths.length === 0) return;
  spawnSync('git', ['add', ...paths], { stdio: 'inherit' });
}

function gitleaksInstalled(): boolean {
  const result = spawnSync('gitleaks', ['version'], { stdio: 'ignore', shell: false });
  return result.status === 0;
}

/**
 * Hard block on any staged secret/state file (defends against `git add -f`, which
 * bypasses .gitignore). gitleaks scans content; this rejects the files outright so
 * provisioned secrets in `.env.<environment>` / `.setup-state.*` can never be committed.
 */
function checkSecretFilesStaged(stagedFiles: string[]): number {
  const allowed = /(^|\/)\.env\.example$|(^|\/)\.setup-credentials\.example$/;
  const secretFile =
    /(^|\/)\.env(\.[^/]*)?$|(^|\/)\.setup-credentials$|(^|\/)\.setup-state\.(json|lock|audit\.log)$|(^|\/)setup\.secrets\.json$/;
  const offenders = stagedFiles.filter((file) => secretFile.test(file) && !allowed.test(file));
  if (offenders.length > 0) {
    console.error(
      'ERROR: Refusing to commit secret/state files (these are gitignored for a reason):',
    );
    for (const file of offenders) console.error(`  ${file}`);
    console.error(
      'Secrets belong in .env.<environment> / .setup-state.json only — never in git. Unstage them (git restore --staged <file>).',
    );
    return 1;
  }
  return 0;
}

function checkConflictMarkers(stagedFiles: string[]): number {
  if (stagedFiles.length === 0) return 0;
  const result = spawnSync(
    'bash',
    [
      '-c',
      `git diff --cached --name-only -z | xargs -0 grep -lE '^<<<<<<<|^>>>>>>>|^=======$' 2>/dev/null || true`,
    ],
    { encoding: 'utf8', shell: false },
  );
  const conflictFiles = (result.stdout ?? '').trim();
  if (conflictFiles.length > 0) {
    console.error('ERROR: Merge conflict markers found in:');
    console.error(conflictFiles);
    return 1;
  }
  return 0;
}

function checkLargeStagedFiles(stagedFiles: string[]): number {
  const largeFiles: string[] = [];
  for (const file of stagedFiles) {
    try {
      const sizeOutput = execSync(`git cat-file -s ":${file}"`, { encoding: 'utf8' }).trim();
      const size = Number.parseInt(sizeOutput, 10);
      if (Number.isFinite(size) && size > ONE_MEGABYTE) {
        largeFiles.push(`  ${file} (${Math.floor(size / 1024)}KB)`);
      }
    } catch {
      // Skip files git cannot resolve (e.g. deleted-only staging edge cases).
    }
  }
  if (largeFiles.length > 0) {
    console.error(`ERROR: Files exceed 1MB limit:\n${largeFiles.join('\n')}`);
    return 1;
  }
  return 0;
}

function checkEnvExampleSync(): number {
  const result = spawnSync('pnpm', ['tool:sync-env-example'], { stdio: 'inherit', shell: false });
  if (result.status === 0) return 0;
  console.error('ERROR: .env.example is out of sync with env schema.');
  console.error('Run: pnpm tool:sync-env-example --fix  (then add descriptions)');
  return result.status ?? 1;
}

/** Builds the ordered pre-commit guard step list (always + conditional steps). */
export function buildGuardSteps(options: {
  stagedFiles: string[];
  scripts: Record<string, string>;
}): GuardStep[] {
  const { stagedFiles, scripts } = options;
  const steps: GuardStep[] = [
    {
      id: '1',
      label: 'lint-staged (Biome + markdownlint)',
      when: 'always',
      description: 'pnpm lint-staged',
    },
    { id: '2', label: 'TypeScript typecheck', when: 'always', description: 'pnpm typecheck' },
    {
      id: '3',
      label: 'Domain structure (strict)',
      when: 'always',
      description: 'pnpm validate:domain:strict',
    },
    {
      id: '3b',
      label: 'Architecture policy tests',
      when: shouldRunGlobalTests(stagedFiles) ? 'always' : 'conditional',
      description:
        'pnpm test:global (service boundary, no direct DB, import paths, no NODE_ENV branching — when domains / env-schema / harness / workflows / Docker staged)',
    },
    {
      id: '4',
      label: 'Scripts layout',
      when: 'always',
      description: 'pnpm validate:scripts-layout',
    },
    {
      id: '5',
      label: 'Route catalog regenerate',
      when: 'always',
      description: 'pnpm routes:catalog + git add docs/routes.txt',
    },
    {
      id: '6',
      label: 'Route catalog drift check',
      when: 'always',
      description: 'pnpm routes:catalog:check',
    },
  ];

  if (hasPackageScript(scripts, 'tool:project-structure-tree')) {
    steps.push({
      id: '6b',
      label: 'Source tree regenerate',
      when: shouldRunStructureTreeCheck(stagedFiles) ? 'always' : 'conditional',
      description: `pnpm tool:project-structure-tree + git add ${SRC_STRUCTURE_TREE_PATH} (when src/** or tooling/** staged)`,
    });
  }

  if (hasPackageScript(scripts, 'tool:project-structure-tree:check')) {
    steps.push({
      id: '6c',
      label: 'Source tree drift check',
      when: shouldRunStructureTreeCheck(stagedFiles) ? 'always' : 'conditional',
      description: 'pnpm tool:project-structure-tree:check (when src/** or tooling/** staged)',
    });
  }

  steps.push(
    {
      id: '7',
      label: 'OpenAPI / Postman drift',
      when: shouldRunOpenApiCheck(stagedFiles) ? 'always' : 'conditional',
      description: 'pnpm docs:check (when OpenAPI inputs staged)',
    },
    { id: '8', label: 'TSDoc coverage gate', when: 'always', description: 'pnpm tsdoc:check' },
  );

  if (hasPackageScript(scripts, 'validate:test-naming')) {
    steps.push({
      id: '9',
      label: 'Test filename suffixes',
      when: 'always',
      description: 'pnpm validate:test-naming',
    });
  }

  steps.push(
    {
      id: '10',
      label: 'Migration SQL safety',
      when: shouldRunMigrationCheck(stagedFiles) ? 'always' : 'conditional',
      description: 'pnpm db:migrate:lint (when migrations/*.sql staged)',
    },
    {
      id: '10b',
      label: 'DBML regenerate',
      when: shouldRunMigrationCheck(stagedFiles) ? 'always' : 'conditional',
      description: `pnpm tool:generate-dbdiagram + git add ${DBML_PATH} (when migrations staged)`,
    },
    {
      id: '11',
      label: 'Project identity drift',
      when: 'always',
      description: 'pnpm tool:generate-project-identity:check',
    },
    {
      id: '12',
      label: 'Env example sync',
      when: 'always',
      description: 'pnpm tool:sync-env-example',
    },
    {
      id: '13',
      label: 'Staged secrets scan',
      when: 'always',
      description: 'gitleaks protect --staged --verbose --redact',
    },
    {
      id: '14',
      label: 'No secret/state files staged',
      when: 'always',
      description:
        'reject staged .env.<env> / .setup-state.* / setup.secrets.json (force-add guard)',
    },
    {
      id: '15',
      label: 'Merge conflict markers',
      when: 'always',
      description: 'grep staged files for conflict markers',
    },
    {
      id: '16',
      label: 'Large staged files (>1MB)',
      when: 'always',
      description: 'reject staged files over 1MB',
    },
    {
      id: '17',
      label: 'SonarQube quality gate',
      when: shouldRunSonarScan(stagedFiles) ? 'always' : 'conditional',
      description:
        'pnpm sonar:scan — blocks the commit on any unresolved SonarQube issue/hotspot (when deployed-surface src/**/*.ts staged)',
    },
  );

  return steps;
}

function printStepTable(steps: GuardStep[]): void {
  console.log('| Step | Label | When |');
  console.log('|------|-------|------|');
  for (const step of steps) {
    console.log(`| ${step.id} | ${step.label} | ${step.description} |`);
  }
}

function runStep(options: {
  stepNumber: number;
  stepTotal: number;
  label: string;
  run: () => number;
}): number {
  const { stepNumber, stepTotal, label, run } = options;
  console.log(`▶ Step ${stepNumber}/${stepTotal}: ${label}`);
  const exitCode = run();
  if (exitCode === 0) {
    console.log(`✓ ${label}`);
    return 0;
  }
  console.error(`✗ FAILED at step ${stepNumber}/${stepTotal}: ${label} (exit ${exitCode})`);
  return exitCode;
}

/** Runs the labeled pre-commit guard; returns process exit code (0 = success). */
export function runPreCommitGuard(options: RunGuardOptions = {}): number {
  const scripts = options.packageScripts ?? readPackageScripts();
  const stagedFiles = options.stagedFiles ?? getStagedFiles();
  const steps = buildGuardSteps({ stagedFiles, scripts });

  if (options.listOnly) {
    printStepTable(steps);
    return 0;
  }

  const runnableSteps: Array<{ label: string; run: () => number }> = [
    {
      label: 'lint-staged (Biome + markdownlint)',
      run: () => runPnpm('lint-staged', ['--no-stash']),
    },
    { label: 'TypeScript typecheck', run: () => runPnpm('typecheck') },
    { label: 'Domain structure (strict)', run: () => runPnpm('validate:domain:strict') },
    {
      label: 'Architecture policy tests',
      run: () => (shouldRunGlobalTests(stagedFiles) ? runPnpm('test:global') : 0),
    },
    { label: 'Scripts layout', run: () => runPnpm('validate:scripts-layout') },
    {
      label: 'Route catalog regenerate',
      run: () => {
        const code = runPnpm('routes:catalog');
        if (code !== 0) return code;
        gitAdd([ROUTES_CATALOG_PATH]);
        return 0;
      },
    },
    { label: 'Route catalog drift check', run: () => runPnpm('routes:catalog:check') },
  ];

  if (hasPackageScript(scripts, 'tool:project-structure-tree')) {
    runnableSteps.push({
      label: 'Source tree regenerate',
      run: () => {
        if (!shouldRunStructureTreeCheck(stagedFiles)) return 0;
        const code = runPnpm('tool:project-structure-tree');
        if (code !== 0) return code;
        gitAdd([SRC_STRUCTURE_TREE_PATH]);
        return 0;
      },
    });
  }

  if (hasPackageScript(scripts, 'tool:project-structure-tree:check')) {
    runnableSteps.push({
      label: 'Source tree drift check',
      run: () => {
        if (!shouldRunStructureTreeCheck(stagedFiles)) return 0;
        return runPnpm('tool:project-structure-tree:check');
      },
    });
  }

  runnableSteps.push(
    {
      label: 'OpenAPI / Postman drift',
      run: () => (shouldRunOpenApiCheck(stagedFiles) ? runPnpm('docs:check') : 0),
    },
    { label: 'TSDoc coverage gate', run: () => runPnpm('tsdoc:check') },
  );

  if (hasPackageScript(scripts, 'validate:test-naming')) {
    runnableSteps.push({
      label: 'Test filename suffixes',
      run: () => runPnpm('validate:test-naming'),
    });
  }

  runnableSteps.push(
    {
      label: 'Migration SQL safety',
      run: () => (shouldRunMigrationCheck(stagedFiles) ? runPnpm('db:migrate:lint') : 0),
    },
    {
      label: 'DBML regenerate',
      run: () => {
        if (!shouldRunMigrationCheck(stagedFiles)) return 0;
        const code = runPnpm('tool:generate-dbdiagram');
        if (code !== 0) return code;
        gitAdd([DBML_PATH]);
        return 0;
      },
    },
    {
      label: 'Project identity drift',
      run: () => runPnpm('tool:generate-project-identity:check'),
    },
    {
      label: 'Env example sync',
      run: () => checkEnvExampleSync(),
    },
  );

  if (!options.skipShellSteps) {
    runnableSteps.push(
      {
        label: 'Staged secrets scan',
        run: () => {
          if (!gitleaksInstalled()) {
            console.error(
              'ERROR: gitleaks is not installed. Install it (e.g. brew install gitleaks) or run: pnpm setup:infra',
            );
            return 1;
          }
          return runShell('gitleaks protect --staged --verbose --redact');
        },
      },
      {
        label: 'No secret/state files staged',
        run: () => checkSecretFilesStaged(stagedFiles),
      },
      {
        label: 'Merge conflict markers',
        run: () => checkConflictMarkers(stagedFiles),
      },
      {
        label: 'Large staged files (>1MB)',
        run: () => checkLargeStagedFiles(stagedFiles),
      },
      {
        label: 'SonarQube quality gate',
        run: () => (shouldRunSonarScan(stagedFiles) ? runPnpm('sonar:scan') : 0),
      },
    );
  }

  const stepTotal = runnableSteps.length;
  for (let index = 0; index < runnableSteps.length; index += 1) {
    const step = runnableSteps[index]!;
    const exitCode = runStep({
      stepNumber: index + 1,
      stepTotal,
      label: step.label,
      run: step.run,
    });
    if (exitCode !== 0) return exitCode;
  }

  return 0;
}

const currentScriptPath = resolve(fileURLToPath(import.meta.url));

function main(): void {
  const listOnly = process.argv.includes('--list');
  const exitCode = runPreCommitGuard({ listOnly });
  process.exit(exitCode);
}

if (process.argv[1] && resolve(process.argv[1]) === currentScriptPath) {
  main();
}
