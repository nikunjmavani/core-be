/**
 * Interactive step orchestrator.
 *
 * Wraps a single provisioning step in a uniform: explain → execute → verify → recover loop.
 *
 * Flow:
 *   1. Print step header.
 *   2. If !descriptor.enabled, mark "skipped (disabled)" and return.
 *   3. If descriptor.alreadyDone() → mark "already-done" and return.
 *   4. Print instructions (so the user understands what's about to happen).
 *   5. Prompt: continue / skip / abort.
 *   6. Execute; on throw, ask retry / skip / abort.
 *   7. Verify state (read the in-memory run state); fail prompt if missing.
 *   8. Verify live (call provider check API); fail prompt if unhealthy.
 *
 * Used by orchestrator.runProvision so every provisioning step is interactive.
 */
import { createInterface } from 'node:readline';
import * as logger from './logger.js';
import { SetupError } from './setup-error.js';

export type StepDecision = 'continue' | 'skip' | 'abort';
export type FailureDecision = 'retry' | 'skip' | 'abort';
export type StepStatus =
  | 'completed'
  | 'skipped'
  | 'aborted'
  | 'failed'
  | 'disabled'
  | 'already-done';

export interface StateVerification {
  ok: boolean;
  message: string;
}

export interface LiveVerification {
  ok: boolean;
  message: string;
}

/** Result of a resource existence/drift check (state-based). */
export interface ResourceStatus {
  /** `absent` → will create · `present` → up-to-date · `drift` → exists but config changed. */
  state: 'absent' | 'present' | 'drift';
  /** One-line human description shown in the plan and the step header. */
  detail: string;
  /** For `drift`: the specific config-vs-state differences. */
  changes?: string[];
}

/** Shorthand for a state-based existence check: present → `present`, else `absent`. */
export function resourceStatus(present: boolean, presentDetail: string): ResourceStatus {
  return present
    ? { state: 'present', detail: presentDetail }
    : { state: 'absent', detail: 'will create' };
}

export interface StepDescriptor<T> {
  name: string;
  enabled: boolean;
  /**
   * Reason shown when enabled is false (e.g. "disabled in setup.config.json", "missing secret").
   */
  enabledReason?: string;
  /**
   * Bullet list of what the step is about to do (printed before the continue/skip/abort prompt).
   */
  instructions: string[];
  /**
   * Optional resource existence/drift check (state-based). `absent` → create silently;
   * `present`/`drift` → prompt update/skip. Also consumed by `setup:infra:plan`. Omit for
   * validate-only or always-run steps.
   */
  detectStatus?: () => ResourceStatus | Promise<ResourceStatus>;
  /**
   * Run the actual provisioning. Should throw on failure or return the provider's result.
   */
  execute: () => Promise<T>;
  /**
   * Optional state-only post-check (read the in-memory run state). Fast.
   */
  verifyState?: () => StateVerification;
  /**
   * Optional live verification (provider API call). Slower but proves the resource works.
   */
  verifyLive?: () => Promise<LiveVerification>;
}

export interface StepOutcome<T> {
  name: string;
  status: StepStatus;
  result?: T;
  errorMessage?: string;
  detail?: string;
}

/**
 * Guard: setup-infra is interactive and human-only (no CI / unattended runs). Throws
 * when stdin/stdout isn't a TTY so a piped/automated invocation fails fast and clearly.
 */
export function assertInteractive(): void {
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new SetupError('setup:infra is interactive and human-only — run it in a terminal.');
  }
}

async function ask(question: string, defaultValue: string): Promise<string> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolvePromise) => {
    readline.question(`  ${question} [${defaultValue}]: `, (answer) => {
      readline.close();
      const trimmed = answer.trim();
      resolvePromise(trimmed === '' ? defaultValue : trimmed.toLowerCase());
    });
  });
}

async function promptStepDecision(): Promise<StepDecision> {
  while (true) {
    const answer = await ask('Proceed? (c)ontinue / (s)kip / (a)bort', 'c');
    if (['c', 'continue', 'y', 'yes'].includes(answer)) return 'continue';
    if (['s', 'skip'].includes(answer)) return 'skip';
    if (['a', 'abort', 'q', 'quit', 'exit'].includes(answer)) return 'abort';
    logger.warn('  Please answer with c (continue), s (skip), or a (abort).');
  }
}

/**
 * Decision when a resource already exists (org/project/environment present): update it
 * (re-run the step) or skip and keep what's there. Defaults to skip — never mutate
 * existing infrastructure without an explicit choice.
 */
async function promptExistingDecision(): Promise<'update' | 'skip'> {
  while (true) {
    const answer = await ask('Already present — (u)pdate / (s)kip', 's');
    if (['u', 'update', 'y', 'yes'].includes(answer)) return 'update';
    if (['s', 'skip', 'n', 'no'].includes(answer)) return 'skip';
    logger.warn('  Please answer with u (update) or s (skip).');
  }
}

async function promptOnFailure(): Promise<FailureDecision> {
  while (true) {
    const answer = await ask('What now? (r)etry / (s)kip / (a)bort', 'r');
    if (['r', 'retry', 'y', 'yes'].includes(answer)) return 'retry';
    if (['s', 'skip'].includes(answer)) return 'skip';
    if (['a', 'abort', 'q', 'quit', 'exit'].includes(answer)) return 'abort';
    logger.warn('  Please answer with r (retry), s (skip), or a (abort).');
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export async function runInteractiveStep<T>(
  stepNumber: number,
  totalSteps: number,
  descriptor: StepDescriptor<T>,
): Promise<StepOutcome<T>> {
  logger.stepHeader(stepNumber, totalSteps, descriptor.name);

  if (!descriptor.enabled) {
    const reason = descriptor.enabledReason ?? 'disabled in setup.config.json';
    logger.warn(`Skipped — ${reason}`);
    return { name: descriptor.name, status: 'disabled', detail: reason };
  }

  // Tracks an explicit "update existing" choice so we skip the redundant
  // continue/skip/abort prompt below and go straight to execute.
  let updatingExisting = false;

  // Existence/drift check: absent → create; present/drift → prompt update or skip.
  if (descriptor.detectStatus) {
    const status = await descriptor.detectStatus();
    if (status.state !== 'absent') {
      const label = status.state === 'drift' ? 'Drift detected' : 'Already present';
      logger.success(`${label} — ${status.detail}`);
      for (const change of status.changes ?? []) logger.info(`  • ${change}`);
      if ((await promptExistingDecision()) === 'skip') {
        return { name: descriptor.name, status: 'already-done', detail: status.detail };
      }
      updatingExisting = true;
    }
  }

  if (descriptor.instructions.length > 0) {
    logger.instruction(descriptor.instructions);
  }

  // "update existing" already confirmed intent → go straight to execute.
  const decision = updatingExisting ? 'continue' : await promptStepDecision();
  if (decision === 'abort') {
    logger.warn('Aborted by user.');
    return { name: descriptor.name, status: 'aborted' };
  }
  if (decision === 'skip') {
    logger.warn('Skipped by user.');
    return { name: descriptor.name, status: 'skipped' };
  }

  let attempt = 0;
  while (true) {
    attempt += 1;
    if (attempt > 1) logger.info(`Retry attempt #${attempt}...`);

    let result: T;
    try {
      result = await descriptor.execute();
    } catch (executionError) {
      const message = toError(executionError).message;
      logger.error(`Failed: ${message}`);
      const recovery = await promptOnFailure();
      if (recovery === 'retry') continue;
      if (recovery === 'skip') {
        return { name: descriptor.name, status: 'failed', errorMessage: message };
      }
      return { name: descriptor.name, status: 'aborted', errorMessage: message };
    }

    if (descriptor.verifyState) {
      const stateCheck = descriptor.verifyState();
      if (!stateCheck.ok) {
        logger.error(`State verification failed: ${stateCheck.message}`);
        const recovery = await promptOnFailure();
        if (recovery === 'retry') continue;
        if (recovery === 'skip') {
          return {
            name: descriptor.name,
            status: 'failed',
            errorMessage: `state: ${stateCheck.message}`,
          };
        }
        return {
          name: descriptor.name,
          status: 'aborted',
          errorMessage: `state: ${stateCheck.message}`,
        };
      }
      logger.success(`State verified — ${stateCheck.message}`);
    }

    if (descriptor.verifyLive) {
      const liveSpinner = logger.startSpinner('Verifying live resource...');
      let liveCheck: LiveVerification;
      try {
        liveCheck = await descriptor.verifyLive();
      } catch (liveError) {
        liveCheck = { ok: false, message: toError(liveError).message };
      }
      if (liveCheck.ok) {
        logger.stopSpinner(liveSpinner, `Live verified — ${liveCheck.message}`);
      } else {
        logger.stopSpinner(liveSpinner, `Live verification failed — ${liveCheck.message}`, 'fail');
        const recovery = await promptOnFailure();
        if (recovery === 'retry') continue;
        if (recovery === 'skip') {
          return {
            name: descriptor.name,
            status: 'failed',
            errorMessage: `live: ${liveCheck.message}`,
            result,
          };
        }
        return {
          name: descriptor.name,
          status: 'aborted',
          errorMessage: `live: ${liveCheck.message}`,
          result,
        };
      }
    }

    logger.success(`${descriptor.name} — done.`);
    return { name: descriptor.name, status: 'completed', result };
  }
}

export function summarizeOutcomes(outcomes: StepOutcome<unknown>[]): {
  rows: Array<{ env: string; status: string; detail: string }>;
  hasFailures: boolean;
} {
  const rows = outcomes.map((outcome) => ({
    env: outcome.name,
    status:
      outcome.status === 'completed'
        ? 'OK'
        : outcome.status === 'already-done'
          ? 'OK'
          : outcome.status === 'disabled'
            ? 'OFF'
            : outcome.status === 'skipped'
              ? 'SKIP'
              : outcome.status === 'aborted'
                ? 'ABORT'
                : 'FAIL',
    detail: outcome.errorMessage ?? outcome.detail ?? '',
  }));

  const hasFailures = outcomes.some(
    (outcome) => outcome.status === 'failed' || outcome.status === 'aborted',
  );

  return { rows, hasFailures };
}
