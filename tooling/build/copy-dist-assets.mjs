#!/usr/bin/env node
/**
 * Copies runtime assets that `tsc` does not emit into `dist/`.
 *
 * `tsc` compiles TypeScript only. A compiled module that resolves a non-TS file
 * relative to its own location therefore finds nothing after a plain `pnpm build`:
 * `circuit-breaker.ts` loads its Lua script via `import.meta.url`, so `pnpm start`
 * and `pnpm start:worker` both died with ENOENT on `circuit-mutate.lua`.
 *
 * The Dockerfile runtime stage already copies these paths explicitly, which is why
 * production images were unaffected and the gap went unnoticed. This script mirrors
 * those `COPY` lines so the documented local `build` → `start` path matches the image.
 *
 * Parity with the Dockerfile is pinned by
 * `src/tests/unit/ci/dist-assets.policy.unit.test.ts`.
 *
 * Usage: node tooling/build/copy-dist-assets.mjs (runs as part of `pnpm build`)
 */
import { cp, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Repo-root-relative source → destination pairs. Every entry must correspond to a
 * `COPY --from=build /app/<from> ./<to>` line in the Dockerfile runtime stage.
 */
const DIST_ASSETS = [
  { from: 'src/infrastructure/resilience/lua', to: 'dist/src/infrastructure/resilience/lua' },
];

async function main() {
  for (const { from, to } of DIST_ASSETS) {
    const source = resolve(repositoryRoot, from);
    const sourceStat = await stat(source).catch(() => null);
    if (!sourceStat) {
      throw new Error(`copy-dist-assets: source does not exist: ${from}`);
    }
    await cp(source, resolve(repositoryRoot, to), { recursive: true });
    console.log(`copy-dist-assets: ${from} → ${to}`);
  }
}

await main();
