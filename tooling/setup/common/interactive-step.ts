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
 *   7. Verify state (read .setup-state.json); fail prompt if missing.
 *   8. Verify live (call provider check API); fail prompt if unhealthy.
 *
 * Used by orchestrator.runProvision so every provisioning step is interactive.
 */
import { createInterface } from 'node:readline';
import * as logger from './logger.js';

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
   * Optional: if true, the step is already complete — skip prompt entirely.
   * For per-environment checks, use alreadyDoneForEnvironment instead.
   */
  alreadyDone?: () => boolean | Promise<boolean>;
  alreadyDoneMessage?: string;
  /**
   * Optional: per-environment already-done check.
   * Returns which environments are already done (should be skipped).
   * Environments NOT in the returned set will be created.
   */
  alreadyDoneEnvironments?: (environments: string[]) => Promise<Set<string>>;
  alreadyDoneEnvironmentMessage?: (env: string) => string;
  /**
   * Run the actual provisioning. Should throw on failure or return the provider's result.
   */
  execute: () => Promise<T>;
  /**
   * Optional state-only post-check (read .setup-state.json). Fast.
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

export interface RunInteractiveStepOptions {
  assumeYes?: boolean;
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
  options: RunInteractiveStepOptions = {},
): Promise<StepOutcome<T>> {
  logger.stepHeader(stepNumber, totalSteps, descriptor.name);

  if (!descriptor.enabled) {
    const reason = descriptor.enabledReason ?? 'disabled in setup.config.json';
    logger.warn(`Skipped — ${reason}`);
    return { name: descriptor.name, status: 'disabled', detail: reason };
  }

  if (descriptor.alreadyDone) {
    const done = await descriptor.alreadyDone();
    if (done) {
      const message = descriptor.alreadyDoneMessage ?? 'already provisioned (state matches)';
      logger.success(`Already complete — ${message}`);
      return { name: descriptor.name, status: 'already-done', detail: message };
    }
  }

  // Per-environment already-done check: shows which envs are done vs will-create
  let doneEnvs: Set<string> = new Set();
  if (descriptor.alreadyDoneEnvironments) {
    doneEnvs = await descriptor.alreadyDoneEnvironments(
      (descriptor as StepDescriptor<T> & { _environments: string[] })._environments ?? [],
    );
    if (doneEnvs.size > 0) {
      const doneList = [...doneEnvs].join(', ');
      logger.success(`Already done: ${doneList}`);
    }
    const todoList = (
      (descriptor as StepDescriptor<T> & { _environments: string[] })._environments ?? []
    ).filter((e) => !doneEnvs.has(e));
    if (todoList.length > 0) {
      logger.info(`Will create: ${todoList.join(', ')}`);
    }
    if (doneEnvs.size > 0 && todoList.length === 0) {
      return { name: descriptor.name, status: 'already-done', detail: 'all environments complete' };
    }
  }

  if (descriptor.instructions.length > 0) {
    logger.instruction(descriptor.instructions);
  }

  const decision = options.assumeYes ? 'continue' : await promptStepDecision();
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
      if (options.assumeYes) {
        return { name: descriptor.name, status: 'failed', errorMessage: message };
      }
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
        if (options.assumeYes) {
          return {
            name: descriptor.name,
            status: 'failed',
            errorMessage: `state: ${stateCheck.message}`,
          };
        }
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
        if (options.assumeYes) {
          return {
            name: descriptor.name,
            status: 'failed',
            errorMessage: `live: ${liveCheck.message}`,
            result,
          };
        }
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
