/**
 * Labeled wrapper for `pnpm ci:local` — runs each chained step with step names.
 * Run: `pnpm guard:ci-local` or `pnpm guard:ci-local:list`
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CI_LOCAL_SCRIPT = 'ci:local';

/** Parses the chained `ci:local` script from `package.json` into individual commands. */
export function readCiLocalSteps(packageJsonScripts?: Record<string, string>): string[] {
  const scripts =
    packageJsonScripts ??
    (
      JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
        scripts?: Record<string, string>;
      }
    ).scripts;
  const script = scripts?.[CI_LOCAL_SCRIPT];
  if (!script) {
    throw new Error(`Missing package.json script: ${CI_LOCAL_SCRIPT}`);
  }
  return script.split(' && ').map((step) => step.trim());
}

/** Strips the `pnpm ` prefix for display labels. */
export function formatCiLocalStepLabel(command: string): string {
  return command.startsWith('pnpm ') ? command.slice('pnpm '.length) : command;
}

function readCiLocalStepsFromDisk(): string[] {
  return readCiLocalSteps();
}

function runStep(stepIndex: number, stepTotal: number, command: string): void {
  const label = formatCiLocalStepLabel(command);
  console.log(`\n▶ Step ${stepIndex}/${stepTotal}: ${label}`);
  const result = spawnSync(command, {
    shell: true,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    console.error(
      `\n✗ FAILED at step ${stepIndex}/${stepTotal}: ${label} (exit ${result.status ?? 1})`,
    );
    process.exit(result.status ?? 1);
  }
  console.log(`✓ ${label}`);
}

function main(): void {
  const listOnly = process.argv.includes('--list');
  const steps = readCiLocalStepsFromDisk();

  if (listOnly) {
    steps.forEach((step, index) => {
      console.log(`${index + 1}. ${formatCiLocalStepLabel(step)}`);
    });
    return;
  }

  console.log(`Running ${steps.length} ci:local steps…`);
  steps.forEach((step, index) => {
    runStep(index + 1, steps.length, step);
  });
  console.log('\n✅ ci:local completed');
}

const currentScriptPath = resolve(fileURLToPath(import.meta.url));

if (process.argv[1] && resolve(process.argv[1]) === currentScriptPath) {
  main();
}
