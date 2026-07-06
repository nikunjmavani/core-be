#!/usr/bin/env tsx
/**
 * agent-os hooks telemetry report — aggregates agent-os/hooks/.telemetry.log
 * (written by _telemetry.sh / _telemetry.mjs) into a per-hook summary: total
 * runs, fired vs silent, silent ratio, and last-fired timestamp.
 *
 * Every hook declared in agent-os/hooks/hooks.json is listed even with zero
 * runs, so a hook that never fires (or was never invoked) is visible. A hook
 * silent for 30+ days is a pruning candidate — see agent-os/hooks/README.md.
 *
 * Read-only: it never writes or deletes the log. Usage: `pnpm agent-os:hooks:report`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const repositoryRoot = process.cwd();
const logPath = join(repositoryRoot, 'agent-os', 'hooks', '.telemetry.log');
const manifestPath = join(repositoryRoot, 'agent-os', 'hooks', 'hooks.json');

interface Stat {
  total: number;
  fired: number;
  silent: number;
  lastFired: string | null;
  lastRun: string | null;
}

const declaredHookIds: string[] = existsSync(manifestPath)
  ? (
      (JSON.parse(readFileSync(manifestPath, 'utf8')) as { hooks?: Array<{ id?: string }> }).hooks ??
      []
    )
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string')
  : [];

const stats = new Map<string, Stat>();
const ensure = (id: string): Stat => {
  const existing = stats.get(id);
  if (existing) return existing;
  const fresh: Stat = { total: 0, fired: 0, silent: 0, lastFired: null, lastRun: null };
  stats.set(id, fresh);
  return fresh;
};
for (const id of declaredHookIds) ensure(id);

if (existsSync(logPath)) {
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [timestamp, hookId, , status] = trimmed.split(',');
    if (!hookId) continue;
    const stat = ensure(hookId);
    stat.total++;
    if (status === 'fired') {
      stat.fired++;
      if (timestamp && (!stat.lastFired || timestamp > stat.lastFired)) stat.lastFired = timestamp;
    } else stat.silent++;
    if (timestamp && (!stat.lastRun || timestamp > stat.lastRun)) stat.lastRun = timestamp;
  }
}

const now = Date.now();
const daysAgo = (iso: string | null): number | null =>
  iso ? Math.floor((now - Date.parse(iso)) / (24 * 60 * 60 * 1000)) : null;

const rows = [...stats.entries()].sort((a, b) => b[1].fired - a[1].fired);

console.log('\nagent-os hook telemetry\n');
if (!existsSync(logPath)) console.log('  (no .telemetry.log yet — hooks log here as they run)\n');
console.log('  hook                      runs   fired  silent  silent%  last-fired');
console.log('  ------------------------  -----  -----  ------  -------  ----------');
const pruningCandidates: string[] = [];
for (const [id, stat] of rows) {
  const silentPct = stat.total ? Math.round((stat.silent / stat.total) * 100) : 0;
  const firedDays = daysAgo(stat.lastFired);
  const lastFired = stat.lastFired ? `${firedDays}d ago` : 'never';
  console.log(
    `  ${id.padEnd(24)}  ${String(stat.total).padStart(5)}  ${String(stat.fired).padStart(5)}  ${String(stat.silent).padStart(6)}  ${String(silentPct).padStart(6)}%  ${lastFired}`,
  );
  if (stat.fired === 0 || (firedDays !== null && firedDays >= 30)) pruningCandidates.push(id);
  else if (firedDays === null && stat.total === 0) pruningCandidates.push(id);
}

console.log('');
if (pruningCandidates.length) {
  console.log(
    `⚠ pruning candidates (never fired, or silent 30+ days): ${pruningCandidates.join(', ')}`,
  );
  console.log('  Review monthly — a hook that never fires is dead weight (agent-os/hooks/README.md).\n');
} else {
  console.log('✓ every declared hook has fired recently.\n');
}
