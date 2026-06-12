/**
 * Local mirror of the CI "OpenAPI breaking-change" gate (`pnpm docs:breaking`).
 *
 * oasdiff is a Go binary with no npm distribution, so it cannot live in
 * package.json devDependencies — this script downloads the SAME pinned,
 * checksum-verified release CI uses (see `.github/workflows/pr-ci.yml`) into
 * `.cache/oasdiff/` on first run, generates the base spec from `origin/dev`
 * in a temporary git worktree, regenerates the head spec from the working
 * tree, and diffs them with the committed err-ignore file:
 *
 *   pnpm docs:breaking
 *
 * Exit code 0 = no unaccepted breaking changes (same criterion as CI).
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OASDIFF_VERSION = '1.18.1';
const OASDIFF_SHA256: Record<string, string> = {
  linux_amd64: '5174ba660d559684e67e8ab44ca6d45919114f8c57de5a1e32b91d4e5347705d',
  darwin_all: '87fb54389cbce33a471d735baf0e14df5d3a921edb850c3858abd742d2669769',
};

const repoRoot = process.cwd();
const cacheDirectory = resolve(repoRoot, '.cache', 'oasdiff', OASDIFF_VERSION);
const binaryPath = join(cacheDirectory, 'oasdiff');
const ignoreFilePath = resolve(repoRoot, '.github/oasdiff/breaking-changes-ignore.txt');
const headSpecPath = resolve(repoRoot, 'docs/openapi/openapi.json');

function platformArtifact(): string {
  if (process.platform === 'darwin') return 'darwin_all';
  if (process.platform === 'linux' && process.arch === 'x64') return 'linux_amd64';
  throw new Error(
    `Unsupported platform for the pinned oasdiff binary: ${process.platform}/${process.arch}`,
  );
}

function ensureBinary(): void {
  if (existsSync(binaryPath)) return;
  const artifact = platformArtifact();
  const url = `https://github.com/oasdiff/oasdiff/releases/download/v${OASDIFF_VERSION}/oasdiff_${OASDIFF_VERSION}_${artifact}.tar.gz`;
  const tarballPath = join(tmpdir(), `oasdiff-${OASDIFF_VERSION}-${artifact}.tar.gz`);
  console.log(`Downloading oasdiff v${OASDIFF_VERSION} (${artifact})…`);
  execFileSync('curl', ['-sSfL', url, '-o', tarballPath]);
  const digest = createHash('sha256').update(readFileSync(tarballPath)).digest('hex');
  const expected = OASDIFF_SHA256[artifact];
  if (digest !== expected) {
    rmSync(tarballPath, { force: true });
    throw new Error(`oasdiff tarball checksum mismatch: expected ${expected}, got ${digest}`);
  }
  mkdirSync(cacheDirectory, { recursive: true });
  execFileSync('tar', ['-xzf', tarballPath, '-C', cacheDirectory, 'oasdiff']);
  chmodSync(binaryPath, 0o755);
  rmSync(tarballPath, { force: true });
}

function generateBaseSpec(): string {
  const worktreePath = join(tmpdir(), `core-be-oasdiff-base-${process.pid}`);
  const baseSpecPath = join(tmpdir(), `core-be-base-openapi-${process.pid}.json`);
  console.log('Generating base spec from origin/dev (temporary worktree)…');
  execFileSync('git', ['fetch', 'origin', 'dev', '--quiet'], { cwd: repoRoot });
  execFileSync('git', ['worktree', 'add', '--detach', worktreePath, 'origin/dev', '--quiet'], {
    cwd: repoRoot,
  });
  try {
    execFileSync('pnpm', ['install', '--prefer-offline', '--silent'], {
      cwd: worktreePath,
      stdio: 'pipe',
    });
    execFileSync('pnpm', ['docs:generate'], { cwd: worktreePath, stdio: 'pipe' });
    copyFileSync(join(worktreePath, 'docs/openapi/openapi.json'), baseSpecPath);
  } finally {
    execFileSync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
  }
  return baseSpecPath;
}

function main(): void {
  ensureBinary();
  const baseSpecPath = process.env.OASDIFF_BASE_SPEC ?? generateBaseSpec();
  console.log('Regenerating head spec from the working tree…');
  execFileSync('pnpm', ['docs:generate'], { cwd: repoRoot, stdio: 'pipe' });
  console.log('Diffing (same flags as CI)…');
  try {
    execFileSync(
      binaryPath,
      ['breaking', baseSpecPath, headSpecPath, '--fail-on', 'ERR', '--err-ignore', ignoreFilePath],
      { stdio: 'inherit' },
    );
    console.log('✅ docs:breaking passed — no unaccepted breaking changes.');
  } catch {
    console.error(
      '\n❌ Unaccepted breaking changes. Either fix the contract or, for intentional changes,\n' +
        'add narrow entries to .github/oasdiff/breaking-changes-ignore.txt (see its header).',
    );
    process.exit(1);
  }
}

main();
