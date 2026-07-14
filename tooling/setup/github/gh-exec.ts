/**
 * Thin wrappers around the `gh` CLI shared by the GitHub sync tooling
 * (`init.ts`, `sync-environment-protection.ts`). Kept in their own module so both
 * consumers import from here rather than from each other (no import cycle).
 */

import { execSync } from 'node:child_process';

/** Outcome of a `gh` invocation that is allowed to fail (e.g. a 404 probe). */
export interface GhProbeResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run a `gh` command, capturing stdout/stderr and never throwing (inspect {@link GhProbeResult.exitCode}). */
export function ghProbe(args: readonly string[]): GhProbeResult {
  try {
    const stdout = execSync(`gh ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (commandError) {
    const errorObject = commandError as {
      status?: number;
      stderr?: Buffer | string;
      stdout?: Buffer | string;
    };
    const stderr =
      typeof errorObject.stderr === 'string'
        ? errorObject.stderr
        : (errorObject.stderr?.toString('utf-8') ?? '');
    const stdout =
      typeof errorObject.stdout === 'string'
        ? errorObject.stdout
        : (errorObject.stdout?.toString('utf-8') ?? '');
    return { exitCode: errorObject.status ?? 1, stdout, stderr };
  }
}

/** Run a write `gh` command with a request body on stdin, throwing a clean error on failure. */
export function ghWriteWithBody(args: readonly string[], body: string): void {
  try {
    execSync(`gh ${args.join(' ')}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 30_000,
      input: body,
    });
  } catch (commandError) {
    const errorObject = commandError as {
      stderr?: Buffer | string;
      stdout?: Buffer | string;
      message?: string;
    };
    const stderr =
      typeof errorObject.stderr === 'string'
        ? errorObject.stderr
        : (errorObject.stderr?.toString('utf-8') ?? '');
    const stdout =
      typeof errorObject.stdout === 'string'
        ? errorObject.stdout
        : (errorObject.stdout?.toString('utf-8') ?? '');
    throw new Error(stderr || stdout || (errorObject.message ?? 'gh command failed'));
  }
}
