// Shared telemetry for the node hooks (guardrails.mjs, cursor-shell-guard.mjs).
// Appends one CSV line — timestamp,hook-id,event,fired|silent — to the gitignored
// agent-os/hooks/.telemetry.log so `pnpm agent-os:hooks:report` can show which
// hooks fire. Fail-open: any error is swallowed so telemetry never blocks a hook.
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Append `timestamp,hookId,event,status` to the telemetry log; never throws. */
export function recordTelemetry(hookId, event, status) {
  try {
    const root =
      process.env.CLAUDE_PROJECT_DIR || join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const line = `${new Date().toISOString()},${hookId},${event},${status}\n`;
    appendFileSync(join(root, 'agent-os', 'hooks', '.telemetry.log'), line);
  } catch {
    /* fail-open — telemetry must never break a hook */
  }
}
