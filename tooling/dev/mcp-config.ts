/**
 * Shared helpers for scaffolding the project MCP config (`.mcp.json`) from the
 * committed template (`.mcp.example.json`).
 *
 * Two tiers (see `docs/integrations/agentic-third-party-tooling.md`):
 *   - **Default auto-start pair** — `codegraph` + `headroom` — declared by
 *     `pnpm setup:local` and the cloud bootstrap so the two zero-config, agent-only
 *     servers are present before the first prompt.
 *   - **On-demand set** — every server in the template — scaffolded by
 *     `pnpm mcp:setup` when a task needs the hosted integrations (most require a
 *     provider token).
 *
 * Merges are non-destructive: existing entries in `.mcp.json` are preserved and only
 * missing servers are added, so real credentials already filled into `.mcp.json` are
 * never clobbered.
 *
 * NOTE (Claude Code on the web): a cloud session's live MCP set is loaded by the
 * platform from the environment's MCP settings — NOT this `.mcp.json`. These helpers
 * scaffold the file for local MCP clients; the web environment is configured in the
 * web UI. See `docs/integrations/claude-code-web-environment.md`.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(HERE, '..', '..');

/** Absolute path to the gitignored, scaffolded MCP config consumed by local clients. */
export const MCP_CONFIG_PATH = resolve(REPOSITORY_ROOT, '.mcp.json');

/** Absolute path to the committed full-set MCP template (source of truth). */
export const MCP_TEMPLATE_PATH = resolve(REPOSITORY_ROOT, '.mcp.example.json');

/**
 * The two zero-config, agent-only MCP servers that should be present by default.
 *
 * Both run a local CLI (`codegraph serve --mcp`, `headroom mcp serve`) with no
 * provider token, so they are safe to auto-start in every session; the rest of the
 * template set is opt-in via `pnpm mcp:setup`.
 */
export const DEFAULT_MCP_SERVER_KEYS = ['codegraph', 'headroom'] as const;

type McpServerDefinition = Record<string, unknown>;

interface McpConfig {
  mcpServers: Record<string, McpServerDefinition>;
}

/** Outcome of an {@link ensureMcpServers} run. */
export interface EnsureResult {
  /** Servers newly written into `.mcp.json`. */
  added: string[];
  /** Servers already declared in `.mcp.json` (left untouched). */
  alreadyPresent: string[];
  /** Requested keys absent from the template (ignored). */
  missingFromTemplate: string[];
  /** Whether `.mcp.json` was modified. */
  changed: boolean;
}

function readConfig(path: string): McpConfig {
  if (!existsSync(path)) return { mcpServers: {} };
  const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<McpConfig>;
  return { mcpServers: parsed.mcpServers ?? {} };
}

/** Read the full server set from the committed `.mcp.example.json` template. */
export function readTemplateServers(): Record<string, McpServerDefinition> {
  if (!existsSync(MCP_TEMPLATE_PATH)) {
    throw new Error(`MCP template not found at ${MCP_TEMPLATE_PATH}`);
  }
  return readConfig(MCP_TEMPLATE_PATH).mcpServers;
}

/**
 * Ensure `.mcp.json` declares the requested servers, copying each definition from the
 * template. Existing entries are never overwritten, so this is safe to re-run.
 *
 * @param options.keys - Server keys to ensure, or `'all'` for every template server.
 * @param options.dryRun - When `true`, report what would change without writing.
 */
export function ensureMcpServers(options: {
  keys: readonly string[] | 'all';
  dryRun?: boolean;
}): EnsureResult {
  const template = readTemplateServers();
  const requested = options.keys === 'all' ? Object.keys(template) : [...options.keys];
  const config = readConfig(MCP_CONFIG_PATH);

  const added: string[] = [];
  const alreadyPresent: string[] = [];
  const missingFromTemplate: string[] = [];

  for (const key of requested) {
    if (!(key in template)) {
      missingFromTemplate.push(key);
      continue;
    }
    if (key in config.mcpServers) {
      alreadyPresent.push(key);
      continue;
    }
    config.mcpServers[key] = template[key] as McpServerDefinition;
    added.push(key);
  }

  const changed = added.length > 0;
  if (changed && options.dryRun !== true) {
    writeFileSync(MCP_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`);
  }
  return { added, alreadyPresent, missingFromTemplate, changed };
}

/** Ensure the default auto-start pair (`codegraph` + `headroom`) is declared. */
export function ensureDefaultMcpServers(options?: { dryRun?: boolean }): EnsureResult {
  return ensureMcpServers({
    keys: DEFAULT_MCP_SERVER_KEYS,
    ...(options?.dryRun !== undefined ? { dryRun: options.dryRun } : {}),
  });
}

/** List every template server key alongside whether it is declared in `.mcp.json`. */
export function listMcpServers(): { key: string; declared: boolean; isDefault: boolean }[] {
  const template = readTemplateServers();
  const declared = readConfig(MCP_CONFIG_PATH).mcpServers;
  const defaults = new Set<string>(DEFAULT_MCP_SERVER_KEYS);
  return Object.keys(template).map((key) => ({
    key,
    declared: key in declared,
    isDefault: defaults.has(key),
  }));
}
