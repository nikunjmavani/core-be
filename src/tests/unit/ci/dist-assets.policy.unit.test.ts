import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the compiled runtime bundle.
 *
 * `tsc` emits TypeScript only, so any non-TS file a compiled module resolves relative
 * to its own location (`import.meta.url`) is absent from `dist/` unless something
 * copies it. The Dockerfile runtime stage copies them explicitly, so production images
 * were fine while `pnpm build && pnpm start` crashed with ENOENT on
 * `circuit-mutate.lua` — the failure only ever showed up on the local path nothing
 * gated.
 *
 * `tooling/build/copy-dist-assets.mjs` now mirrors those `COPY` lines. This test pins
 * the two together: a new asset added to the Dockerfile but not the copy script (or the
 * reverse) fails here rather than at someone's `pnpm start`.
 */
const DOCKERFILE_PATH = join(process.cwd(), 'Dockerfile');
const COPY_SCRIPT_PATH = join(process.cwd(), 'tooling/build/copy-dist-assets.mjs');
const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json');

/** `COPY --from=build /app/<from> ./dist/<to>` — the asset copies, excluding `./dist` itself. */
const DOCKERFILE_DIST_COPY = /^COPY\s+--from=build\s+\/app\/(\S+)\s+\.\/(dist\/\S+)\s*$/gm;

/** `{ from: '…', to: '…' }` entries in the copy script's manifest. */
const MANIFEST_ENTRY = /\{\s*from:\s*'([^']+)',\s*to:\s*'([^']+)'\s*\}/g;

function pairsFrom(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => `${match[1]} → ${match[2]}`).sort();
}

describe('dist runtime assets', () => {
  const dockerfile = readFileSync(DOCKERFILE_PATH, 'utf8');
  const copyScript = readFileSync(COPY_SCRIPT_PATH, 'utf8');

  it('copies every Dockerfile dist asset in the build script, and no others', () => {
    const fromDockerfile = pairsFrom(dockerfile, DOCKERFILE_DIST_COPY);
    const fromManifest = pairsFrom(copyScript, MANIFEST_ENTRY);

    expect(fromDockerfile.length).toBeGreaterThan(0);
    expect(fromManifest).toEqual(fromDockerfile);
  });

  it('still copies the circuit-breaker Lua script', () => {
    expect(copyScript).toContain('src/infrastructure/resilience/lua');
    expect(dockerfile).toContain('/app/src/infrastructure/resilience/lua');
  });

  it('runs the copy script as part of pnpm build', () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts.build).toContain('tooling/build/copy-dist-assets.mjs');
  });
});
