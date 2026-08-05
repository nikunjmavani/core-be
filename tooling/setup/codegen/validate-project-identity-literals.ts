/**
 * Repo-wide gate: project-identity literals (the slug and the GitHub owner) may
 * appear only in files that legitimately carry them.
 *
 * @remarks
 * Algorithm: walk every git-tracked file, skip the excluded categories, skip the
 * files the identity generator itself writes, then flag any remaining occurrence
 * of the manifest's slug or owner unless an allowlist entry covers it.
 *
 * The generator's own targets are exempt BY CONSTRUCTION — they are passed in
 * rather than restated here, so adding a generated artifact can never leave a
 * stale exemption behind.
 *
 * Failure modes: a new hardcoded literal fails the gate with the file and line.
 * A stale allowlist entry (the literal it covers is gone) ALSO fails, so the
 * allowlist cannot silently rot — the same self-validating shape used by
 * `src/tests/unit/ci/redis-set-ttl.policy.unit.test.ts`.
 *
 * Side effects: none; reads the working tree and returns findings.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import type { ProjectIdentitySnapshot } from './project-identity.util.js';

/** A file+reason pair permitting the identity literal to appear verbatim. */
export interface IdentityLiteralAllowance {
  /** Repository-relative path. */
  readonly file: string;
  /** Why the literal is legitimate here — shown when the entry goes stale. */
  readonly reason: string;
}

/** A literal occurrence the gate rejects. */
export interface IdentityLiteralViolation {
  readonly file: string;
  readonly line: number;
  readonly literal: string;
  readonly text: string;
}

/**
 * Path prefixes and suffixes scanned files are drawn from. Prose that names the
 * base project is expected and is not an identity defect, so all Markdown and
 * the agent-tooling mirrors are out of scope.
 */
const EXCLUDED_PREFIXES: readonly string[] = [
  'docs/',
  'agent-os/',
  '.claude/',
  '.cursor/',
  '.codex/',
  '.github/ISSUE_TEMPLATE/',
];

const EXCLUDED_SUFFIXES: readonly string[] = [
  '.md',
  '.mdc',
  '.dbml',
  '.snap',
  '.lock',
  '.png',
  '.jpg',
  '.svg',
  '.ico',
];

const EXCLUDED_FILES: readonly string[] = [
  'CHANGELOG.md',
  'pnpm-lock.yaml',
  'docs/routes.txt',
  'tooling/setup/setup.config.json',
];

/** Files that legitimately carry the literal but are not generator outputs. */
export const IDENTITY_LITERAL_ALLOWLIST: readonly IdentityLiteralAllowance[] = [
  {
    file: '.env.example',
    reason: 'Documents the shipped default values for OTEL_SERVICE_NAME and the Scalar slug.',
  },
  {
    file: '.mcp.example.json',
    reason: 'MCP server key naming this project\'s API server ("<slug>:api").',
  },
  {
    file: '.gitleaks.toml',
    reason: 'Config title naming the project.',
  },
  {
    file: '.codacy.yaml',
    reason: 'Comment naming the project.',
  },
  {
    file: '.github/codeql/codeql-config.yml',
    reason: 'CodeQL config display name.',
  },
  {
    file: '.github/release-please/config.json',
    reason: 'release-please package-name, which must equal package.json name.',
  },
  {
    file: 'tooling/db-viewer/config.json',
    reason: 'DB Viewer display name for the local ER board.',
  },
  {
    file: 'tooling/ci/restore-drill-neon.sh',
    reason:
      'Last-resort fallback for the Neon project name; PROJECT_SLUG from the generated composite action wins when set.',
  },
  {
    file: 'src/tests/load/k6/setup-loadtest.sh',
    reason: 'docker exec/restart against the Compose container names.',
  },
  {
    file: 'src/tests/load/k6/check-prereqs.mjs',
    reason: 'Operator guidance strings naming the Compose containers.',
  },
];

function isExcluded(repositoryRelativePath: string): boolean {
  if (EXCLUDED_FILES.includes(repositoryRelativePath)) return true;
  if (EXCLUDED_PREFIXES.some((prefix) => repositoryRelativePath.startsWith(prefix))) return true;
  return EXCLUDED_SUFFIXES.some((suffix) => repositoryRelativePath.endsWith(suffix));
}

function listTrackedFiles(projectRoot: string): string[] {
  const stdout = execFileSync('git', ['ls-files', '-z'], {
    cwd: projectRoot,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

/** Literals a fork must not hardcode: the project slug and the GitHub owner. */
export function identityLiterals(snapshot: ProjectIdentitySnapshot): string[] {
  return [snapshot.slug, snapshot.repository.owner].filter(
    (literal, index, all) => literal.length > 0 && all.indexOf(literal) === index,
  );
}

export interface IdentityLiteralScanResult {
  readonly violations: IdentityLiteralViolation[];
  /** Allowlist entries whose file no longer contains any identity literal. */
  readonly staleAllowances: IdentityLiteralAllowance[];
}

/**
 * Scan the working tree for hardcoded identity literals.
 *
 * @param options.generatedPaths - Absolute paths the identity generator writes;
 *   exempt by construction so the exemption cannot drift from the generator.
 */
export function scanProjectIdentityLiterals(options: {
  readonly snapshot: ProjectIdentitySnapshot;
  readonly projectRoot: string;
  readonly generatedPaths: readonly string[];
}): IdentityLiteralScanResult {
  const { snapshot, projectRoot } = options;
  const literals = identityLiterals(snapshot);
  const generated = new Set(
    options.generatedPaths.map((path) => relative(projectRoot, path).replaceAll('\\', '/')),
  );
  const allowedFiles = new Map(
    IDENTITY_LITERAL_ALLOWLIST.map((allowance) => [allowance.file, allowance]),
  );
  const allowancesSeen = new Set<string>();

  const violations: IdentityLiteralViolation[] = [];
  for (const file of listTrackedFiles(projectRoot)) {
    if (isExcluded(file) || generated.has(file)) continue;
    const absolute = resolve(projectRoot, file);
    if (!(existsSync(absolute) && statSync(absolute).isFile())) continue;

    const contents = readFileSync(absolute, 'utf-8');
    const matched = literals.filter((literal) => contents.includes(literal));
    if (matched.length === 0) continue;

    if (allowedFiles.has(file)) {
      allowancesSeen.add(file);
      continue;
    }
    for (const [index, text] of contents.split('\n').entries()) {
      for (const literal of matched) {
        if (text.includes(literal)) {
          violations.push({ file, line: index + 1, literal, text: text.trim() });
        }
      }
    }
  }

  const staleAllowances = IDENTITY_LITERAL_ALLOWLIST.filter(
    (allowance) => !allowancesSeen.has(allowance.file),
  );
  return { violations, staleAllowances };
}
