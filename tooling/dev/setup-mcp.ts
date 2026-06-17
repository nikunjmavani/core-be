#!/usr/bin/env tsx
/**
 * `pnpm mcp:setup` — scaffold the project MCP config (`.mcp.json`).
 *
 * The full set of MCP servers (context7, core-be:api, neon, sentry, railway, aws,
 * stripe, semgrep, sonarqube, redis, postman, resend, codegraph, headroom) lives in the
 * committed template `.mcp.example.json`; the default auto-start pair (codegraph +
 * headroom) lives in `.mcp.default.json`. This command copies them into a local,
 * gitignored `.mcp.json` so the agent's MCP clients can connect. Most servers need a
 * provider token (set via env / `${VAR}` placeholders); servers whose key or CLI is
 * missing simply stay disconnected.
 *
 *   pnpm mcp:setup              # all servers (on-demand hosted integrations)
 *   pnpm mcp:setup:default      # only the auto-start pair (codegraph + headroom)
 *   pnpm mcp:setup --check      # report what would change; no write
 *   pnpm mcp:setup --list       # list template servers + .mcp.json status
 *
 * Merges are non-destructive — existing `.mcp.json` entries (with real keys) are kept.
 *
 * NOTE (Claude Code on the web): a cloud session's live MCP set is loaded by the
 * platform from the environment's MCP settings — NOT this `.mcp.json`. Use this command
 * for local clients; configure the web environment's servers in the web UI. The
 * Composio, Descript, and Slack MCPs are intentionally not part of this project. See
 * `docs/integrations/claude-code-web-environment.md`.
 */
import {
  type EnsureResult,
  ensureDefaultMcpServers,
  ensureMcpServers,
  listMcpServers,
  MCP_CONFIG_PATH,
} from './mcp-config.js';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
} as const;

function printHelp(): void {
  process.stdout.write(
    `${ANSI.bold}pnpm mcp:setup${ANSI.reset} — scaffold .mcp.json from .mcp.example.json\n\n` +
      `  pnpm mcp:setup            scaffold ALL template servers (on-demand integrations)\n` +
      `  pnpm mcp:setup:default    scaffold only codegraph + headroom (auto-start pair)\n` +
      `  pnpm mcp:setup --default  same as mcp:setup:default\n` +
      `  pnpm mcp:setup --check    dry run: report what would change, no write\n` +
      `  pnpm mcp:setup --list     list template servers and .mcp.json status\n` +
      `  pnpm mcp:setup --help     show this help\n\n` +
      `Existing .mcp.json entries are never overwritten. On Claude Code web the live MCP\n` +
      `set is configured in the web UI, not this file.\n`,
  );
}

function printList(): void {
  process.stdout.write(`${ANSI.bold}MCP servers in .mcp.example.json${ANSI.reset}\n`);
  for (const { key, declared, isDefault } of listMcpServers()) {
    const mark = declared
      ? `${ANSI.green}✓ declared${ANSI.reset}`
      : `${ANSI.gray}· absent${ANSI.reset}`;
    const tag = isDefault ? ` ${ANSI.cyan}(default)${ANSI.reset}` : '';
    process.stdout.write(`  ${mark}  ${key}${tag}\n`);
  }
  process.stdout.write(
    `\n${ANSI.gray}default = auto-start pair (codegraph + headroom)${ANSI.reset}\n`,
  );
}

function reportResult(result: EnsureResult, dryRun: boolean): void {
  if (result.missingFromTemplate.length > 0) {
    process.stdout.write(
      `${ANSI.yellow}!${ANSI.reset} not in template (ignored): ${result.missingFromTemplate.join(', ')}\n`,
    );
  }
  if (result.alreadyPresent.length > 0) {
    process.stdout.write(
      `${ANSI.gray}○ already declared: ${result.alreadyPresent.join(', ')}${ANSI.reset}\n`,
    );
  }
  if (!result.changed) {
    process.stdout.write(
      `${ANSI.green}✓${ANSI.reset} .mcp.json already up to date — nothing to do.\n`,
    );
    return;
  }
  const verb = dryRun ? 'would add' : 'added';
  process.stdout.write(`${ANSI.green}✓${ANSI.reset} ${verb}: ${result.added.join(', ')}\n`);
  if (!dryRun) process.stdout.write(`${ANSI.gray}wrote ${MCP_CONFIG_PATH}${ANSI.reset}\n`);
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }
  if (argv.includes('--list')) {
    printList();
    return;
  }
  const dryRun = argv.includes('--check') || argv.includes('--dry-run');
  const defaultOnly = argv.includes('--default');

  const scope = defaultOnly ? 'default pair (codegraph + headroom)' : 'full set';
  process.stdout.write(
    `${ANSI.bold}Scaffolding .mcp.json — ${scope}${dryRun ? ' (dry run)' : ''}${ANSI.reset}\n`,
  );
  try {
    const result = defaultOnly
      ? ensureDefaultMcpServers({ dryRun })
      : ensureMcpServers({ keys: 'all', dryRun });
    reportResult(result, dryRun);
  } catch (error) {
    process.stderr.write(
      `${ANSI.yellow}mcp:setup failed${ANSI.reset}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(1);
  }
}

main();
