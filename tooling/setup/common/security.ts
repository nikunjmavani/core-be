/**
 * Security checks for setup tooling.
 *
 * - Secret leak detection: scans files for API key patterns in wrong sections
 * - File permission check: warns if .env.setup or .env.<env> are world-readable
 */
import { statSync } from 'node:fs';
import * as logger from './logger.js';

const SECRET_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /napi_[a-zA-Z0-9]+/, name: 'Neon API key' },
  { pattern: /sk_(live|test)_[a-zA-Z0-9]+/, name: 'Stripe secret key' },
  { pattern: /sntrys_[a-zA-Z0-9]+/, name: 'Sentry auth token' },
  { pattern: /re_[a-zA-Z0-9]+/, name: 'Resend API key' },
  { pattern: /ghp_[a-zA-Z0-9]+/, name: 'GitHub personal access token' },
  { pattern: /gho_[a-zA-Z0-9]+/, name: 'GitHub OAuth token' },
  { pattern: /ghu_[a-zA-Z0-9]+/, name: 'GitHub user token' },
  { pattern: /ghs_[a-zA-Z0-9]+/, name: 'GitHub server token' },
  { pattern: /ghr_[a-zA-Z0-9]+/, name: 'GitHub refresh token' },
  { pattern: /AKIA[0-9A-Z]{16}/, name: 'AWS access key ID' },
  { pattern: /PMAK-[a-zA-Z0-9]+/, name: 'Postman API key' },
];

/**
 * Scan a single line for secret patterns. Returns array of matches found.
 */
export function scanLineForSecrets(line: string): string[] {
  const found: string[] = [];
  for (const { pattern, name } of SECRET_PATTERNS) {
    if (pattern.test(line)) {
      found.push(name);
    }
  }
  return found;
}

/**
 * Scan file contents for secret patterns. Returns array of findings.
 */
export function scanFileForSecrets(
  content: string,
  _filename: string,
): Array<{ line: number; pattern: string }> {
  const findings: Array<{ line: number; pattern: string }> = [];
  const lines = content.split('\n');
  for (const [zeroBasedIndex, line] of lines.entries()) {
    if (line.startsWith('#') || line.trim() === '') continue;
    const matches = scanLineForSecrets(line);
    for (const match of matches) {
      findings.push({ line: zeroBasedIndex + 1, pattern: match });
    }
  }
  return findings;
}

/**
 * Check if a file has secure permissions (600 — owner read/write only).
 * Returns true if permissions are safe, false if world/group readable.
 */
export function checkFilePermissions(filePath: string): { safe: boolean; mode: string } {
  try {
    const stats = statSync(filePath);
    const mode = (stats.mode & 0o777).toString(8);
    const isSafe = (stats.mode & 0o077) === 0; // no group/world bits
    return { safe: isSafe, mode };
  } catch {
    return { safe: true, mode: 'unknown' };
  }
}

/**
 * Run security checks on setup files. Logs warnings for issues found.
 */
export function runSecurityChecks(envSetupPath: string, envFiles: string[]): boolean {
  let allSafe = true;

  // Check .env.setup permissions
  const setupPerms = checkFilePermissions(envSetupPath);
  if (!setupPerms.safe) {
    logger.warn(
      `.env.setup has permissions ${setupPerms.mode} (should be 600). Run: chmod 600 ${envSetupPath}`,
    );
    allSafe = false;
  }

  // Check .env.<env> permissions
  for (const envFile of envFiles) {
    const perms = checkFilePermissions(envFile);
    if (!perms.safe) {
      logger.warn(
        `${envFile} has permissions ${perms.mode} (should be 600). Run: chmod 600 ${envFile}`,
      );
      allSafe = false;
    }
  }

  return allSafe;
}

/** Redact a secret value for safe logging. */
export function redactSecret(value: string): string {
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}
