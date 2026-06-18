#!/usr/bin/env tsx
/**
 * agent-os generator — compiles each agent's native wiring FROM the common
 * agent-os/ sources, and (in --check mode) fails when a hand-edited artifact
 * has drifted from that single source.
 *
 * Single source: agent-os/hooks/hooks.json (hook wiring) + agent-os/platforms/
 * targets.json (capability registry). Derived artifacts: the `hooks` block of
 * .claude/settings.json and the `hooks` block of .cursor/hooks.json. Everything
 * else in those files (Claude `permissions`, Cursor `$schema`/`version`) is
 * owned by hand and preserved verbatim. --check compares semantically (parsed,
 * key-order-independent) so the existing hand-formatted files pass unchanged.
 *
 * Usage:
 *   tsx tooling/agent-os/generate.ts            # default: --check (drift gate)
 *   tsx tooling/agent-os/generate.ts --check    # compare generated vs on-disk; exit 1 on drift
 *   tsx tooling/agent-os/generate.ts --write     # write the derived artifacts from source
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = process.cwd();
const agentOsDirectory = join(repositoryRoot, 'agent-os');
const writeMode = process.argv.includes('--write');

interface HookManifestEntry {
  id: string;
  runtime: 'bash' | 'node';
  script: string;
  claude?: { event: string; matcher?: string };
  cursor?: { event: string; matcher?: string };
}
interface HookManifest {
  hooks: HookManifestEntry[];
}
interface AgentTarget {
  capabilities: { hookEvents: string[] };
  hooksTarget: string | null;
}
interface TargetsRegistry {
  agents: Record<string, AgentTarget>;
}

const readJson = <T>(absolutePath: string): T =>
  JSON.parse(readFileSync(absolutePath, 'utf8')) as T;

const problems: string[] = [];
const report = (message: string) => problems.push(message);

const manifest = readJson<HookManifest>(join(agentOsDirectory, 'hooks', 'hooks.json'));
const targets = readJson<TargetsRegistry>(join(agentOsDirectory, 'platforms', 'targets.json'));

const claudeTarget = targets.agents.claude;
const cursorTarget = targets.agents.cursor;

/** Claude command form: `<runtime> "$CLAUDE_PROJECT_DIR/agent-os/hooks/<script>"`. */
const claudeCommand = (entry: HookManifestEntry): string =>
  `${entry.runtime} "$CLAUDE_PROJECT_DIR/agent-os/hooks/${entry.script}"`;
/** Cursor command form, relative to .cursor/: `<runtime> ../agent-os/hooks/<script>`. */
const cursorCommand = (entry: HookManifestEntry): string =>
  `${entry.runtime} ../agent-os/hooks/${entry.script}`;

type ClaudeHookEntry = { matcher?: string; hooks: Array<{ type: 'command'; command: string }> };

/** Build the Claude `hooks` block, grouped by event in first-appearance order. */
function buildClaudeHooks(): Record<string, ClaudeHookEntry[]> {
  const supported = new Set(claudeTarget?.capabilities.hookEvents ?? []);
  const grouped: Record<string, ClaudeHookEntry[]> = {};
  for (const entry of manifest.hooks) {
    if (!entry.claude) continue;
    if (!supported.has(entry.claude.event)) {
      report(
        `claude: hook "${entry.id}" targets unsupported event ${entry.claude.event} — skipped`,
      );
      continue;
    }
    const command = claudeCommand(entry);
    const hookEntry: ClaudeHookEntry = entry.claude.matcher
      ? { matcher: entry.claude.matcher, hooks: [{ type: 'command', command }] }
      : { hooks: [{ type: 'command', command }] };
    const event = entry.claude.event;
    const bucket = grouped[event] ?? [];
    bucket.push(hookEntry);
    grouped[event] = bucket;
  }
  return grouped;
}

/** Build the Cursor `hooks` block, grouped by event. */
function buildCursorHooks(): Record<string, Array<{ command: string }>> {
  const supported = new Set(cursorTarget?.capabilities.hookEvents ?? []);
  const grouped: Record<string, Array<{ command: string }>> = {};
  for (const entry of manifest.hooks) {
    if (!entry.cursor) continue;
    if (!supported.has(entry.cursor.event)) {
      report(
        `cursor: hook "${entry.id}" targets unsupported event ${entry.cursor.event} — skipped`,
      );
      continue;
    }
    const event = entry.cursor.event;
    const bucket = grouped[event] ?? [];
    bucket.push({ command: cursorCommand(entry) });
    grouped[event] = bucket;
  }
  return grouped;
}

/** Recursively sort object keys so comparison ignores key order (arrays stay ordered). */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort())
      sorted[key] = canonical((value as Record<string, unknown>)[key]);
    return sorted;
  }
  return value;
}
const deepEqual = (left: unknown, right: unknown): boolean =>
  JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

const claudeHooks = buildClaudeHooks();
const cursorHooks = buildCursorHooks();

// ── Claude: .claude/settings.json (hooks block only; permissions preserved) ──
const claudeSettingsPath = join(
  repositoryRoot,
  claudeTarget?.hooksTarget ?? '.claude/settings.json',
);
if (existsSync(claudeSettingsPath)) {
  const settings = readJson<Record<string, unknown>>(claudeSettingsPath);
  if (writeMode) {
    // Idempotent: only write when the hooks actually differ, so an unchanged
    // file is never reformatted (do-no-harm).
    if (!deepEqual(settings.hooks, claudeHooks)) {
      settings.hooks = claudeHooks;
      writeFileSync(claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`);
      report('wrote .claude/settings.json');
    }
  } else if (!deepEqual(settings.hooks, claudeHooks)) {
    report(
      'drift: .claude/settings.json hooks differ from agent-os/hooks/hooks.json — run `pnpm agent-os:generate --write`',
    );
  }
} else report(`missing: ${claudeSettingsPath}`);

// ── Cursor: .cursor/hooks.json (hooks block only; $schema/version preserved) ──
const cursorHooksPath = join(repositoryRoot, cursorTarget?.hooksTarget ?? '.cursor/hooks.json');
if (existsSync(cursorHooksPath)) {
  const cursorConfig = readJson<Record<string, unknown>>(cursorHooksPath);
  if (writeMode) {
    // Idempotent: skip the write when content matches, preserving the existing
    // hand-formatted file instead of canonicalising it.
    if (!deepEqual(cursorConfig.hooks, cursorHooks)) {
      cursorConfig.hooks = cursorHooks;
      writeFileSync(cursorHooksPath, `${JSON.stringify(cursorConfig, null, 2)}\n`);
      report('wrote .cursor/hooks.json');
    }
  } else if (!deepEqual(cursorConfig.hooks, cursorHooks)) {
    report(
      'drift: .cursor/hooks.json hooks differ from agent-os/hooks/hooks.json — run `pnpm agent-os:generate --write`',
    );
  }
} else report(`missing: ${cursorHooksPath}`);

// ── Report ──
const drift = problems.filter(
  (message) => message.startsWith('drift') || message.startsWith('missing'),
);
console.log(`\nagent-os generate (${writeMode ? 'write' : 'check'})\n`);
console.log(`  agents: ${Object.keys(targets.agents).join(', ')}`);
console.log(
  `  claude hooks: ${Object.values(claudeHooks).flat().length}   cursor hooks: ${Object.values(cursorHooks).flat().length}\n`,
);
for (const message of problems) console.log(`  • ${message}`);
console.log('');
if (!writeMode && drift.length) {
  console.log(`✗ DRIFT — ${drift.length} derived artifact(s) out of sync with agent-os/ source\n`);
  process.exit(1);
}
console.log(`✓ ${writeMode ? 'wrote derived artifacts' : 'in sync — no drift'}\n`);
