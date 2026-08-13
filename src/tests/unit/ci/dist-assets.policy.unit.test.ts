import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression guard for the compiled runtime bundle.
 *
 * @remarks
 * `tsc` emits TypeScript only, so any non-TS file a compiled module resolves relative to its own
 * location (`import.meta.url`) is absent from `dist/` unless something copies it. That is how
 * `pnpm build && pnpm start` came to crash with ENOENT on `circuit-mutate.lua` while production
 * images were fine — the Dockerfile copied the assets a second time, so only the local path broke,
 * and nothing gated it.
 *
 * The fix is one source of truth: `tooling/build/copy-dist-assets.mjs` runs as the last step of
 * `pnpm build`, and the Dockerfile's runtime stage copies the finished `dist/` wholesale. This
 * test pins that arrangement from both ends — the script must run in `build`, and the Dockerfile
 * must NOT re-copy an asset the script already places, because a second copy is a second list that
 * can silently diverge.
 *
 * Both images are checked, not just the API one. `Dockerfile.worker` mirrors the API image's
 * runtime stage, and an earlier revision of this test looked at `Dockerfile` alone — so removing
 * the duplicate COPY from one and not the other passed here and failed in CI on
 * `check-dockerfile-sync.mjs`. That is the drift this test exists to prevent, slipping through the
 * test itself.
 */
const DOCKERFILE_PATHS = [
  join(process.cwd(), 'Dockerfile'),
  join(process.cwd(), 'Dockerfile.worker'),
];
const COPY_SCRIPT_PATH = join(process.cwd(), 'tooling/build/copy-dist-assets.mjs');
const PACKAGE_JSON_PATH = join(process.cwd(), 'package.json');

/** `COPY --from=build /app/<from> ./dist/<to>` — an asset copied *into* dist by the Dockerfile. */
const DOCKERFILE_INTO_DIST_COPY = /^COPY\s+--from=build\s+\/app\/(\S+)\s+\.\/dist\/(\S+)\s*$/gm;

/** `{ from: '…', to: '…' }` entries in the copy script's manifest. */
const MANIFEST_ENTRY = /\{\s*from:\s*'([^']+)',\s*to:\s*'([^']+)'\s*\}/g;

describe('dist runtime assets', () => {
  const dockerfiles = DOCKERFILE_PATHS.map((path) => ({
    name: path.split('/').pop() ?? path,
    contents: readFileSync(path, 'utf8'),
  }));
  const copyScript = readFileSync(COPY_SCRIPT_PATH, 'utf8');

  it('runs the copy script as the last step of pnpm build', () => {
    const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.build).toContain('tooling/build/copy-dist-assets.mjs');
  });

  it('declares at least one asset to copy', () => {
    // A manifest that silently emptied would make this whole guard vacuous.
    expect([...copyScript.matchAll(MANIFEST_ENTRY)].length).toBeGreaterThan(0);
  });

  it('still carries the circuit-breaker Lua script', () => {
    // The specific asset whose absence produced the original ENOENT.
    expect(copyScript).toContain('src/infrastructure/resilience/lua');
  });

  it.each(DOCKERFILE_PATHS.map((path) => path.split('/').pop()))(
    '%s copies the built dist directory in its runtime stage',
    (name) => {
      const { contents } = dockerfiles.find((entry) => entry.name === name) ?? { contents: '' };

      expect(contents).toMatch(/^COPY\s+--from=build\s+\/app\/dist\s+\.\/dist\s*$/m);
    },
  );

  it.each(DOCKERFILE_PATHS.map((path) => path.split('/').pop()))(
    '%s does NOT re-copy any asset the build script already places into dist',
    (name) => {
      // The point of the fix. `pnpm build` runs in the build stage, so `/app/dist` is already
      // complete by the time the runtime stage copies it. A `COPY … ./dist/<something>` line here
      // would be a second list of assets, free to drift from the script's — which is exactly the
      // divergence that let production stay healthy while local `pnpm start` crashed.
      const { contents } = dockerfiles.find((entry) => entry.name === name) ?? { contents: '' };
      const duplicated = [...contents.matchAll(DOCKERFILE_INTO_DIST_COPY)].map(
        (match) => `${match[1]} → dist/${match[2]}`,
      );

      expect(duplicated).toEqual([]);
    },
  );

  it.each(DOCKERFILE_PATHS.map((path) => path.split('/').pop()))(
    '%s builds before copying dist, so the script has run',
    (name) => {
      // Ordering matters: if the runtime stage ever copied dist from a stage that had not run
      // `pnpm build`, the assets would be missing again with no other signal.
      const { contents } = dockerfiles.find((entry) => entry.name === name) ?? { contents: '' };
      const buildIndex = contents.indexOf('pnpm build');
      const copyDistIndex = contents.search(/^COPY\s+--from=build\s+\/app\/dist\s+\.\/dist\s*$/m);

      expect(buildIndex).toBeGreaterThan(-1);
      expect(copyDistIndex).toBeGreaterThan(buildIndex);
    },
  );
});
