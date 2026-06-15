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
const isEnvSecretFile = /(^|\/)\.env(\.[\w.-]+)?$/.test(filePath) && !/\.env\.example$/.test(filePath);
if ((tool === "Write" || tool === "Edit") && isEnvSecretFile) {
  deny(
    `Blocked by core-be guardrail: "${filePath}" is a gitignored secrets file. Put template keys in .env.example and provide real values via the environment, not source control.`,
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
