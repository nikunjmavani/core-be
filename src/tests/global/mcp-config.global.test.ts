/**
 * Policy: the committed MCP templates stay consistent (no drift between the two files).
 *
 * - `.mcp.example.json` is the full agent-only set; `.mcp.default.json` is the default
 *   auto-start pair (codegraph + headroom). The pair must mirror its entries in the full
 *   set exactly, so deriving the default from a separate committed file cannot drift.
 * - Both templates are mirrored under `agent-os/mcp/` (the agent-os source of truth); the
 *   root file and its mirror must be equal.
 *
 * See docs/integrations/agentic-third-party-tooling.md and CLAUDE.md (MCP servers).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROJECT_ROOT = process.cwd();

type McpServers = Record<string, Record<string, unknown>>;

function readMcpServers(relativePath: string): McpServers {
  const raw = readFileSync(join(PROJECT_ROOT, relativePath), 'utf-8');
  const parsed = JSON.parse(raw) as { mcpServers?: McpServers };
  return parsed.mcpServers ?? {};
}

const EXPECTED_DEFAULT_KEYS = ['codegraph', 'headroom'];

describe('MCP template consistency', () => {
  const fullSet = readMcpServers('.mcp.example.json');
  const defaultPair = readMcpServers('.mcp.default.json');

  it('mirrors .mcp.example.json under agent-os/mcp/', () => {
    expect(readMcpServers('agent-os/mcp/mcp.example.json')).toEqual(fullSet);
  });

  it('mirrors .mcp.default.json under agent-os/mcp/', () => {
    expect(readMcpServers('agent-os/mcp/mcp.default.json')).toEqual(defaultPair);
  });

  it('default pair is exactly codegraph + headroom', () => {
    expect(Object.keys(defaultPair).sort()).toEqual([...EXPECTED_DEFAULT_KEYS].sort());
  });

  it('every default-pair server matches its full-set definition (no drift)', () => {
    for (const [key, definition] of Object.entries(defaultPair)) {
      expect(fullSet, `${key} missing from .mcp.example.json`).toHaveProperty(key);
      expect(definition, `${key} definition differs from .mcp.example.json`).toEqual(fullSet[key]);
    }
  });
});
