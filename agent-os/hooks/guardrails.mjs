#!/usr/bin/env node
// Claude Code PreToolUse guardrail for core-be.
//
// BLOCK (deny): destructive shell commands, writes to secret files / secret content.
// WARN (systemMessage): edits to protected paths, cross-domain imports in a service.
//
// Reads the PreToolUse payload on stdin. Fail-open by design: any parse/read
// error allows the tool (exit 0) so a guardrail bug can never brick the agent.
import { readFileSync } from "node:fs";

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const tool = payload.tool_name || "";
const input = payload.tool_input || {};
const filePath = input.file_path || input.path || "";
const command = input.command || "";
const content = [input.content, input.new_string].filter(Boolean).join("\n");

const warnings = [];

// A real secrets file the agent must not read or write: app `.env.<env>`, setup-tooling
// credentials `.setup-credentials` (or legacy `.env.setup`), and `.setup-state.*` — but
// NOT the committed templates (`*.example`).
function isReadableSecretPath(p) {
  if (!p) return false;
  if (/(^|\/)\.setup-credentials\.example$/.test(p)) return false; // committed template
  if (/(^|\/)\.setup-credentials$/.test(p)) return true; // setup-tooling input credentials
  if (/(^|\/)\.setup-state\.(json|lock|audit\.log)$/.test(p)) return true;
  if (/(^|\/)\.env\.example$/.test(p) || /(^|\/)\.env\.setup\.example$/.test(p)) return false;
  return /(^|\/)\.env(\.[\w.-]+)?$/.test(p);
}

const SECRET_READ_DENIAL =
  "Blocked by core-be guardrail: reading secrets files (.env.<env> / .setup-credentials / .setup-state.*) " +
  "is not allowed for the agent — they hold provisioned secrets. App config goes in .env.<environment> " +
  "(editable), setup creds in .setup-credentials (off-limits). If a human needs a value: `pnpm setup:infra:output --copy <KEY>`.";

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

// --- BLOCK: agent reading secrets files --------------------------------------
if (tool === "Read" && isReadableSecretPath(filePath)) {
  deny(SECRET_READ_DENIAL);
}
if (tool === "Bash" && command) {
  // Any token that resolves to a secrets file (cat/grep/cp/source/< redirection, …).
  const touchesSecret = command
    .split(/[\s;|&><()'"`]+/)
    .some((token) => isReadableSecretPath(token.replace(/^['"]|['"]$/g, "")));
  if (touchesSecret) deny(SECRET_READ_DENIAL);
}

// --- BLOCK: destructive shell ------------------------------------------------
if (tool === "Bash" && command) {
  // Scan with quoted strings + heredoc bodies removed, so destructive patterns
  // that merely appear in a message/echo (e.g. a commit message) don't trigger.
  const scan = command
    .replace(/<<-?\s*['"]?[A-Za-z_]\w*['"]?[\s\S]*$/, " ")
    .replace(/'[^']*'/g, " ")
    .replace(/"[^"]*"/g, " ");
  let why = "";
  if (/\brm\s+-[a-z]*r[a-z]*f|\brm\s+-[a-z]*f[a-z]*r/i.test(scan)) {
    why = "recursive force delete (rm -rf)";
  } else if (
    /\bgit\s+push\b/i.test(scan) &&
    (/--force(?!-with-lease)/i.test(scan) || /\s-f(?:\s|$)/.test(scan))
  ) {
    why = "git push --force (use --force-with-lease, or push it yourself)";
  } else if (/:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(scan)) {
    why = "fork bomb";
  } else if (/\bmkfs\b|\bdd\s+if=/i.test(scan)) {
    why = "filesystem-destroying command";
  }
  if (why) {
    deny(
      `Blocked by core-be guardrail: ${why}. Command: "${command.slice(0, 160)}". If you truly intend this, run it yourself in a terminal.`,
    );
  }
  if (/\bgit\s+reset\s+--hard\b/i.test(scan) || /\bgit\s+clean\s+-[a-z]*f/i.test(scan)) {
    warnings.push(`destructive git op ("${command.slice(0, 80)}") discards uncommitted work.`);
  }
}

// --- BLOCK: secrets ----------------------------------------------------------
// Same path set as reads — app `.env.<env>`, `.setup-credentials`, `.setup-state.*`
// (templates `*.example` excluded). Edit app config in `.env.<environment>`, never these.
if ((tool === "Write" || tool === "Edit") && isReadableSecretPath(filePath)) {
  deny(
    `Blocked by core-be guardrail: "${filePath}" is a gitignored secrets file. App config templates go in .env.example; setup-tooling creds in .setup-credentials are written by the setup CLI, not by hand.`,
  );
}
const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  /\bsk_live_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bghp_[A-Za-z0-9]{36}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/,
];
if ((tool === "Write" || tool === "Edit") && content && secretPatterns.some((re) => re.test(content))) {
  deny(
    "Blocked by core-be guardrail: the content looks like a private key or live credential. Use environment variables / a secret manager instead of committing secrets.",
  );
}

// --- WARN: protected paths ---------------------------------------------------
if ((tool === "Write" || tool === "Edit") && filePath) {
  if (/(^|\/)migrations\/.+\.sql$/.test(filePath)) {
    warnings.push(
      `editing a migration (${filePath}) — applied migrations are immutable; add a NEW migration instead. Run pnpm db:migrate:lint.`,
    );
  }
  if (/billing\//i.test(filePath) && /(ledger|invoice|charge)/i.test(filePath)) {
    warnings.push(`editing a billing file (${filePath}) — billing ledgers are append-only; confirm this change is additive.`);
  }
}

// --- WARN: cross-domain imports in a service ---------------------------------
if ((tool === "Write" || tool === "Edit") && /src\/domains\/[^/]+\/.*\.service\.ts$/.test(filePath) && content) {
  const own = (filePath.match(/src\/domains\/([^/]+)\//) || [])[1] || "";
  const importRe = /@\/domains\/([^/]+)\/[^'"]*\.(repository|schema)(?:\.js)?['"]/g;
  const offenders = new Set();
  let m;
  while ((m = importRe.exec(content)) !== null) {
    if (m[1] !== own) offenders.add(`@/domains/${m[1]} (${m[2]})`);
  }
  if (offenders.size) {
    warnings.push(
      `service in "${own}" imports another domain's ${[...offenders].join(", ")} — cross-domain access must go through that domain's service, never its repository/schema.`,
    );
  }
}

if (warnings.length) {
  process.stdout.write(JSON.stringify({ systemMessage: "⚠️ core-be guardrail:\n- " + warnings.join("\n- ") }));
}
process.exit(0);
