/**
 * Adopt this repository as the starting point for a new project.
 *
 * Automates the checklist in `docs/getting-started/adopting-as-template.md`:
 * collects the new identity, rewrites `tooling/setup/setup.config.json`,
 * regenerates every identity artifact, resyncs the lockfile, and reports the
 * manual remainder (provider secrets, the GitHub Template flag).
 *
 * Usage:
 *   pnpm init:project                       # interactive
 *   pnpm init:project --name acme-api --repository acme/acme-api --yes
 *   pnpm init:project --dry-run             # show the plan, write nothing
 *   pnpm init:project --reset-history       # ALSO perform the destructive fork reset
 *
 * @remarks
 * Identity-only by default. `--reset-history` is what truncates the changelog and
 * deletes the base project's review artifacts and coverage budgets; it is opt-in
 * and confirmed by typing an exact phrase, because it is irreversible and this
 * script is typically run once, on a fresh clone, by someone who has not read it.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { resolve } from 'node:path';

import { generateAllProjectIdentityArtifacts } from '@tooling/setup/codegen/generate-project-identity.js';
import { loadConfigIfExists, saveConfig } from '@tooling/setup/common/config.js';
import type { SetupConfig } from '@tooling/setup/common/types.js';
import * as log from '@tooling/setup/common/logger.js';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '../..');

/** Phrase the operator must type to authorize the irreversible fork reset. */
const RESET_CONFIRMATION_PHRASE = 'reset';

/** Paths deleted by `--reset-history` — artifacts describing the BASE project's history. */
const FORK_RESET_PATHS: ReadonlyArray<{ path: string; description: string }> = [
  { path: 'docs/reviews', description: "the base project's archived review reports" },
  {
    path: 'tooling/route-coverage/route-success-coverage-budget.json',
    description: 'observed route-coverage budget (regenerated on the next full test run)',
  },
];

interface InitOptions {
  readonly name?: string | undefined;
  readonly displayName?: string | undefined;
  readonly packageName?: string | undefined;
  readonly description?: string | undefined;
  readonly repository?: string | undefined;
  readonly owners?: string[] | undefined;
  readonly resetHistory: boolean;
  readonly dryRun: boolean;
  readonly assumeYes: boolean;
}

function parseArguments(argv: readonly string[]): InitOptions {
  const value = (flag: string): string | undefined => {
    const index = argv.indexOf(flag);
    if (index === -1) return undefined;
    const next = argv[index + 1];
    return next && !next.startsWith('--') ? next : undefined;
  };
  const owners = value('--owners');
  const options: InitOptions = {
    name: value('--name'),
    displayName: value('--display-name'),
    packageName: value('--package-name'),
    description: value('--description'),
    repository: value('--repository'),
    ...(owners ? { owners: owners.split(',').map((owner) => owner.trim()) } : {}),
    resetHistory: argv.includes('--reset-history'),
    dryRun: argv.includes('--dry-run'),
    assumeYes: argv.includes('--yes'),
  };
  return options;
}

async function ask(question: string, fallback: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`  ${question} [${fallback}]: `);
    return answer.trim() === '' ? fallback : answer.trim();
  } finally {
    readline.close();
  }
}

async function askExactPhrase(question: string, expected: string): Promise<boolean> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await readline.question(`  ${question}`);
    return answer.trim() === expected;
  } finally {
    readline.close();
  }
}

/** Slug rules shared with GitHub repository names and Docker image tags. */
function assertValidSlug(slug: string): void {
  if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(slug)) {
    throw new Error(
      `Invalid project slug "${slug}". Use lowercase letters, digits and hyphens (e.g. acme-api) — it becomes the Docker image tag, JWT issuer and MCP URI scheme.`,
    );
  }
}

function assertValidRepository(repository: string): void {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository)) {
    throw new Error(`Invalid repository "${repository}". Expected "owner/repo".`);
  }
}

/**
 * Collect the new identity, preferring flags and falling back to prompts.
 *
 * @remarks
 * Defaults come from the CURRENT manifest, so re-running the script shows the
 * previous answers — the same saved-answers behaviour `pnpm github:sync` has.
 */
async function resolveIdentity(
  current: SetupConfig,
  options: InitOptions,
): Promise<{
  name: string;
  displayName: string;
  packageName: string;
  description?: string;
  repository: string;
  owners: string[];
}> {
  const interactive = !options.assumeYes;
  const name =
    options.name ??
    (interactive ? await ask('Project slug', current.project.name) : current.project.name);
  assertValidSlug(name);

  // Every later default keys off whether the slug actually CHANGED — not off
  // whether `--name` was passed. In an interactive run the new slug arrives from
  // the prompt, so testing the flag would suggest the old repository and names.
  const slugChanged = name !== current.project.name;
  const derivedDefault = (currentValue: string): string => (slugChanged ? name : currentValue);

  const displayName =
    options.displayName ??
    (interactive
      ? await ask('Display name', derivedDefault(current.project.displayName))
      : derivedDefault(current.project.displayName));

  const packageName =
    options.packageName ??
    (interactive
      ? await ask('npm package name', derivedDefault(current.project.packageName ?? name))
      : derivedDefault(current.project.packageName ?? name));

  const currentOwner = current.providers.github.repository.split('/')[0] ?? '';
  const repositoryDefault = slugChanged
    ? `${currentOwner}/${name}`
    : current.providers.github.repository;
  const repository =
    options.repository ??
    (interactive
      ? await ask('GitHub repository (owner/repo)', repositoryDefault)
      : repositoryDefault);
  assertValidRepository(repository);

  const inferredOwner = repository.split('/')[0] ?? '';
  const owners = options.owners ?? [inferredOwner];

  return {
    name,
    displayName,
    packageName,
    ...(options.description ? { description: options.description } : {}),
    repository,
    owners,
  };
}

function runCommand(command: string, args: readonly string[]): void {
  execFileSync(command, [...args], { cwd: REPOSITORY_ROOT, stdio: 'inherit' });
}

/**
 * Report any file still containing the PREVIOUS identity after regeneration.
 *
 * @remarks
 * The CI gate scans for the CURRENT identity outside its allowlist, which cannot
 * see leftovers of the old name. This script is the only place that knows both
 * values, so the residual sweep belongs here. Reported, never auto-edited —
 * most hits are prose that a human should reword.
 */
function reportResidualLiterals(previousSlug: string, previousOwner: string): void {
  const stale = [previousSlug, previousOwner].filter(
    (literal, index, all) => literal.length > 0 && all.indexOf(literal) === index,
  );
  for (const literal of stale) {
    let output = '';
    try {
      // Exclude the historical record. CHANGELOG entries and the release-notes
      // archive DESCRIBE work done on the base project under its old name and
      // cite its issue URLs — rewriting them would falsify history, so listing
      // them here is pure noise that buries the lines a human must actually act
      // on. Prose in docs/ is still reported: it describes the fork now.
      output = execFileSync(
        'git',
        [
          'grep',
          '-rniI',
          '--',
          literal,
          ':!CHANGELOG.md',
          ':!docs/reviews/',
          ':!docs/superpowers/',
          ':!pnpm-lock.yaml',
        ],
        {
          cwd: REPOSITORY_ROOT,
          encoding: 'utf-8',
          maxBuffer: 32 * 1024 * 1024,
        },
      );
    } catch {
      // git grep exits 1 when there are no matches — that is the success case.
      continue;
    }
    const lines = output.split('\n').filter((line) => line.trim() !== '');
    if (lines.length === 0) continue;
    log.warn(
      `${lines.length} file line(s) still mention the previous identity "${literal}" (mostly prose — review and reword):`,
    );
    for (const line of lines.slice(0, 20)) {
      log.infoRaw(`    ${line}`);
    }
    if (lines.length > 20) {
      log.infoRaw(`    … and ${lines.length - 20} more (git grep -n "${literal}")`);
    }
  }
}

function performForkReset(dryRun: boolean): void {
  const changelog = resolve(REPOSITORY_ROOT, 'CHANGELOG.md');
  if (existsSync(changelog)) {
    if (dryRun) {
      log.info('Would truncate CHANGELOG.md to a fresh header.');
    } else {
      writeFileSync(
        changelog,
        '# Changelog\n\nAll notable changes to this project are documented in this file.\n',
        'utf-8',
      );
      log.success('Truncated CHANGELOG.md');
    }
  }
  for (const target of FORK_RESET_PATHS) {
    const absolute = resolve(REPOSITORY_ROOT, target.path);
    if (!existsSync(absolute)) continue;
    if (dryRun) {
      log.info(`Would delete ${target.path} — ${target.description}.`);
      continue;
    }
    rmSync(absolute, { recursive: true, force: true });
    log.success(`Deleted ${target.path}`);
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const current = loadConfigIfExists();
  if (!current) {
    log.error('tooling/setup/setup.config.json is missing or invalid — cannot adopt.');
    process.exit(1);
  }

  const previousSlug = current.project.name;
  const previousOwner = current.providers.github.repository.split('/')[0] ?? '';

  log.blank();
  log.info('Adopting this repository as a new project.');
  log.info('Reference: docs/getting-started/adopting-as-template.md');
  log.blank();

  const identity = await resolveIdentity(current, options);

  log.blank();
  log.info('New identity:');
  log.infoRaw(`    Project slug   : ${identity.name}`);
  log.infoRaw(`    Display name   : ${identity.displayName}`);
  log.infoRaw(`    Package name   : ${identity.packageName}`);
  log.infoRaw(`    Repository     : ${identity.repository}`);
  log.infoRaw(`    CODEOWNERS     : ${identity.owners.map((owner) => `@${owner}`).join(' ')}`);
  log.blank();

  if (options.dryRun) {
    log.warn('--dry-run: no files written.');
    if (options.resetHistory) performForkReset(true);
    return;
  }

  const updated: SetupConfig = {
    ...current,
    project: {
      ...current.project,
      name: identity.name,
      displayName: identity.displayName,
      packageName: identity.packageName,
      ...(identity.description ? { description: identity.description } : {}),
      // Artifact names derive from the slug; drop stale explicit overrides so the
      // defaults regenerate under the new name.
      ...(current.project.artifacts ? { artifacts: undefined } : {}),
    },
    providers: {
      ...current.providers,
      github: {
        ...current.providers.github,
        repository: identity.repository,
        owners: identity.owners,
      },
    },
  };
  saveConfig(updated);
  log.success('Updated tooling/setup/setup.config.json');

  const generated = generateAllProjectIdentityArtifacts();
  if (!generated) {
    log.error('Identity generation reported problems — resolve them, then re-run.');
    process.exit(1);
  }
  log.success('Regenerated project identity artifacts');

  // package.json `name` changed, so the lockfile's root importer is stale.
  log.info('Resyncing the lockfile (pnpm install)…');
  runCommand('pnpm', ['install', '--lockfile-only']);
  log.success('Lockfile resynced');

  if (options.resetHistory) {
    const confirmed =
      options.assumeYes ||
      (await askExactPhrase(
        `This deletes the base project's changelog and review artifacts. Type "${RESET_CONFIRMATION_PHRASE}" to confirm: `,
        RESET_CONFIRMATION_PHRASE,
      ));
    if (confirmed) {
      performForkReset(false);
    } else {
      log.warn('Fork reset skipped (confirmation did not match).');
    }
  }

  // The DBML diagram is named after the slug, so a rename leaves the old file
  // behind: the generator writes the NEW path and never learns about the old one.
  if (identity.name !== previousSlug) {
    const staleDbml = resolve(REPOSITORY_ROOT, `docs/database/${previousSlug}.dbml`);
    if (existsSync(staleDbml)) {
      rmSync(staleDbml, { force: true });
      log.success(
        `Removed stale docs/database/${previousSlug}.dbml (regenerated under the new name)`,
      );
    }
  }

  log.blank();
  reportResidualLiterals(previousSlug, previousOwner);

  log.blank();
  log.info('Remaining manual steps:');
  log.instruction([
    'Create provider accounts and secrets (Stripe, Resend, S3, Sentry, Neon/Postgres, Redis).',
    'Run `pnpm setup:local` to scaffold .env.local, then `pnpm db:migrate`.',
    'Run `pnpm github:sync` to push rulesets, environments and secrets to the new repository.',
    'Replace the placeholder contacts in SECURITY.md and CONTRIBUTING.md.',
    `Enable the GitHub Template flag on the BASE repo if you maintain it: gh api -X PATCH repos/${previousOwner}/${previousSlug} -f is_template=true`,
    'Run `pnpm ci:local` to confirm every gate is green under the new identity.',
  ]);
  log.blank();
  log.success('Adoption complete.');
}

main().catch((error: Error) => {
  log.error(error.message);
  process.exit(1);
});
