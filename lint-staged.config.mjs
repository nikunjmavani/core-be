/**
 * lint-staged config (replaces the inline `"lint-staged"` block in package.json).
 *
 * Markdown exclusions mirror `.markdownlint-cli2.jsonc` `ignores` (CHANGELOGs,
 * PR template, `.claude/`, `node_modules/`). lint-staged passes explicit file
 * paths, which bypass markdownlint-cli2's auto-discovered ignore list, so we
 * filter them in code here.
 *
 * Keeping this in code (instead of a JSON glob like `!CHANGELOG.md`) avoids
 * the brittle micromatch negation-with-paths edge cases that lint-staged hits.
 */

const MARKDOWN_EXCLUDE_PATTERNS = [
  /(?:^|\/)CHANGELOG(?:-dev)?\.md$/,
  /^\.github\/PULL_REQUEST_TEMPLATE\.md$/,
  /^\.claude\//,
  /\/node_modules\//,
];

function filterMarkdown(paths) {
  return paths.filter((path) => !MARKDOWN_EXCLUDE_PATTERNS.some((pattern) => pattern.test(path)));
}

export default {
  'src/**/*.ts': ['biome check --write --no-errors-on-unmatched'],
  'tooling/**/*.{ts,mjs}': ['biome check --write --no-errors-on-unmatched'],
  '*.{json,yaml,yml}': ['biome format --write --no-errors-on-unmatched'],
  '*.md': (paths) => {
    const filtered = filterMarkdown(paths);
    if (filtered.length === 0) {
      return [];
    }
    const quoted = filtered.map((path) => `"${path.replace(/"/g, '\\"')}"`).join(' ');
    return [`markdownlint-cli2 --config .markdownlint.json --fix ${quoted}`];
  },
};
