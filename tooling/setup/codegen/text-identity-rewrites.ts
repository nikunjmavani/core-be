/**
 * Shape-based identity rewrites for files that name the project in free text.
 *
 * @remarks
 * These files carry the project name in a comment, a title, a config key or a
 * shell command, so there is nothing to import and no whole-file template worth
 * owning — only a handful of spans to keep current.
 *
 * Every pattern matches the SHAPE of its span (`title = "<something> gitleaks
 * config"`), never the current slug. Anchoring on the slug is self-disabling:
 * the first rename makes the pattern unmatchable and the rewrite silently stops
 * applying, which is precisely the bug this table exists to prevent. A
 * consequence worth stating: every rule is idempotent, so running the generator
 * twice is a no-op, and running it on an already-renamed fork still works.
 */
import type { ProjectIdentitySnapshot } from './project-identity.util.js';

/** One span to keep current within a text file. */
export interface TextRewriteRule {
  /** Shape-matching pattern. MUST NOT reference the current project slug. */
  readonly pattern: RegExp;
  /** Replacement, resolved against the snapshot. `$1`/`$2` back-references apply. */
  readonly replace: (snapshot: ProjectIdentitySnapshot) => string;
}

/** A file whose identity-bearing spans the generator keeps current. */
export interface TextRewriteTarget {
  /** Repository-relative path. */
  readonly path: string;
  /** Why this file names the project, for the generated-artifact listing. */
  readonly reason: string;
  readonly rules: readonly TextRewriteRule[];
}

/**
 * Files that name the project outside the generated surface.
 *
 * @remarks
 * Two entries fix genuine breakage rather than cosmetics: `release-please`'s
 * `package-name` must equal `package.json`'s `name` or release automation stops
 * matching, and the Sonar scanner's `-Dsonar.projectKey` must equal
 * `sonar-project.properties` or the local quality gate scans a different project
 * than the one configured.
 */
export const TEXT_REWRITE_TARGETS: readonly TextRewriteTarget[] = [
  {
    path: '.codacy.yaml',
    reason: 'Comment naming the project.',
    rules: [
      {
        pattern: /^# Codacy analysis scope for \S+\.$/m,
        replace: (snapshot) => `# Codacy analysis scope for ${snapshot.slug}.`,
      },
    ],
  },
  {
    path: '.gitleaks.toml',
    reason: 'Config title naming the project.',
    rules: [
      {
        pattern: /^title = "\S+ gitleaks config"$/m,
        replace: (snapshot) => `title = "${snapshot.slug} gitleaks config"`,
      },
    ],
  },
  {
    path: '.github/codeql/codeql-config.yml',
    reason: 'CodeQL config display name.',
    rules: [
      {
        pattern: /^# CodeQL analysis configuration for \S+\.$/m,
        replace: (snapshot) => `# CodeQL analysis configuration for ${snapshot.slug}.`,
      },
      {
        pattern: /^name: \S+ CodeQL config$/m,
        replace: (snapshot) => `name: ${snapshot.slug} CodeQL config`,
      },
    ],
  },
  {
    path: '.github/release-please/config.json',
    reason: 'release-please package-name, which must equal package.json name.',
    rules: [
      {
        pattern: /("package-name":\s*)"[^"]*"/,
        replace: (snapshot) => `$1"${snapshot.packageName}"`,
      },
    ],
  },
  {
    path: 'tooling/db-viewer/config.json',
    reason: 'DB Viewer display name for the local ER board.',
    rules: [
      {
        pattern: /("name":\s*)"[^"]*"/,
        replace: (snapshot) => `$1"${snapshot.slug}"`,
      },
    ],
  },
  {
    path: '.env.example',
    reason: 'Header comment, OTEL service-name default, and the Scalar slug default.',
    rules: [
      {
        pattern: /^# \S+ environment variables$/m,
        replace: (snapshot) => `# ${snapshot.slug} environment variables`,
      },
      {
        pattern: /^# Default: \S+-api \/ \S+-worker$/m,
        replace: (snapshot) =>
          `# Default: ${snapshot.artifacts.apiImage} / ${snapshot.artifacts.workerImage}`,
      },
      {
        pattern: /^OTEL_SERVICE_NAME=\S+$/m,
        replace: (snapshot) => `OTEL_SERVICE_NAME=${snapshot.artifacts.apiImage}`,
      },
      {
        pattern: /(the upload script defaults to `)[^`]*(`)/,
        replace: (snapshot) => `$1${snapshot.derived.scalarSlug}$2`,
      },
    ],
  },
  {
    path: 'docker-compose.yml',
    reason: 'Locally built Toxiproxy image tag.',
    rules: [
      {
        pattern: /^(\s*image:\s*)\S+-toxiproxy:/m,
        replace: (snapshot) => `$1${snapshot.derived.containers.toxiproxy}:`,
      },
    ],
  },
  {
    path: 'docker-compose.sonar.yml',
    reason: 'Scanner project key, which must equal sonar-project.properties.',
    rules: [
      {
        pattern: /-Dsonar\.projectKey=\S+/,
        replace: (snapshot) => `-Dsonar.projectKey=${snapshot.derived.sonarProjectKey}`,
      },
      {
        pattern: /-Dsonar\.projectName="[^"]*"/,
        replace: (snapshot) => `-Dsonar.projectName="${snapshot.derived.sonarProjectKey}"`,
      },
    ],
  },
  {
    path: 'tooling/ci/restore-drill-neon.sh',
    reason: 'Last-resort Neon project-name fallback when PROJECT_SLUG is unset.',
    rules: [
      {
        pattern: /(\$\{PROJECT_SLUG:-)[^}]*(\})/,
        replace: (snapshot) => `$1${snapshot.slug}$2`,
      },
    ],
  },
  {
    path: 'src/tests/load/k6/setup-loadtest.sh',
    reason: 'docker exec/restart against the Compose container names.',
    rules: containerCommandRules(),
  },
  {
    path: 'src/tests/load/k6/check-prereqs.mjs',
    reason: 'Operator guidance strings naming the Compose containers.',
    rules: containerCommandRules(),
  },
];

/**
 * MCP template files, which must stay byte-identical to one another.
 *
 * @remarks
 * The `mcp-config` global test pins them as exact mirrors, so they are rewritten
 * with one shared rule set rather than three drifting entries.
 */
export const MCP_TEMPLATE_PATHS: readonly string[] = [
  '.mcp.example.json',
  '.cursor/mcp.example.json',
  'agent-os/mcp/mcp.example.json',
];

/** Rewrite the `"<slug>:api"` MCP server key that names this project's API. */
export function mcpTemplateRules(): readonly TextRewriteRule[] {
  return [
    {
      pattern: /"[a-z0-9][a-z0-9-]*:api":/g,
      replace: (snapshot) => `"${snapshot.slug}:api":`,
    },
  ];
}

/** `docker exec|restart <slug>-postgres|redis` spans in load-test scripts. */
function containerCommandRules(): readonly TextRewriteRule[] {
  return [
    {
      pattern: /\b(docker (?:exec|restart) )\S+-postgres\b/g,
      replace: (snapshot) => `$1${snapshot.derived.containers.postgres}`,
    },
    {
      pattern: /\b(docker (?:exec|restart) )\S+-redis\b/g,
      replace: (snapshot) => `$1${snapshot.derived.containers.redis}`,
    },
  ];
}

/** Apply a target's rules to file contents. Idempotent by construction. */
export function applyTextRewrites(
  contents: string,
  rules: readonly TextRewriteRule[],
  snapshot: ProjectIdentitySnapshot,
): string {
  let updated = contents;
  for (const rule of rules) {
    updated = updated.replace(rule.pattern, rule.replace(snapshot));
  }
  return updated;
}
