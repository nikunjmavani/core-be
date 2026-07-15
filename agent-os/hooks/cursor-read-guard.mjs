#!/usr/bin/env node
// Cursor `beforeReadFile` guardrail for core-be (Cursor agent hooks, beta).
//
// Blocks the agent from reading real secrets files — the same path set the
// Claude PreToolUse guardrail (guardrails.mjs) denies: `.env.<env>` (but not
// the committed `*.example` templates), `.setup-credentials`, `.setup-state.*`.
// Cursor sessions previously had NO read protection at all.
//
// Reads the hook payload on stdin; prints { permission: "allow" | "deny" }.
// Fail-open: any error allows the read.
import { readFileSync } from "node:fs";
import { recordTelemetry } from "./_telemetry.mjs";

function allow() {
  recordTelemetry("cursor-read-guard", "beforeReadFile", "silent");
  process.stdout.write(JSON.stringify({ continue: true, permission: "allow" }));
  process.exit(0);
}
function deny(message) {
  recordTelemetry("cursor-read-guard", "beforeReadFile", "fired");
  process.stdout.write(
    JSON.stringify({ continue: true, permission: "deny", userMessage: message, agentMessage: message }),
  );
  process.exit(0);
}

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8"));
} catch {
  allow();
}

const filePath =
  payload.file_path || payload.filePath || payload.path || (payload.tool_input && payload.tool_input.file_path) || "";
if (!filePath) allow();

// Same predicate as guardrails.mjs isReadableSecretPath().
function isReadableSecretPath(p) {
  if (!p) return false;
  if (/(^|\/)\.setup-credentials$/.test(p)) return true;
  if (/(^|\/)\.setup-state\.(json|lock|audit\.log)$/.test(p)) return true;
  if (/(^|\/)\.env\.example$/.test(p) || /(^|\/)\.env\.setup\.example$/.test(p)) return false;
  return /(^|\/)\.env(\.[\w.-]+)?$/.test(p);
}

if (isReadableSecretPath(filePath)) {
  deny(
    "core-be guardrail: reading secrets files (.env.<env> / .setup-credentials / .setup-state.*) is not allowed for the agent — they hold provisioned secrets. Use .env.example for structure; a human can read values directly.",
  );
}
allow();
