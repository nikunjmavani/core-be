import { createInterface } from 'node:readline';
import { clipboardAvailable, copyToClipboard } from './clipboard.js';
import * as logger from './logger.js';

// ─── Non-interactive (--yes) mode ────────────────────────────────────────────
// When set, every confirmation/decision prompt resolves to its SAFE default without
// blocking on stdin: gating confirms → yes, step/env decisions → continue, "already
// present" → skip, on-failure → skip (never an infinite retry). Enabled by `--yes`/`-y`
// in setup.ts. Lets the whole run proceed unattended after the settings review.
let assumeYes = false;

/** Enable/disable non-interactive mode (auto-answer prompts with their safe default). */
export function setAssumeYes(value: boolean): void {
  assumeYes = value;
}

/** True when `--yes` / non-interactive mode is active. */
export function isAssumeYes(): boolean {
  return assumeYes;
}

export function createReadline(): ReturnType<typeof createInterface> {
  return createInterface({ input: process.stdin, output: process.stdout });
}

export function question(
  readline: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue?: string,
): Promise<string> {
  const suffix = defaultValue !== undefined && defaultValue !== '' ? ` (${defaultValue})` : '';
  return new Promise((resolve) => {
    readline.question(`${prompt}${suffix}: `, (answer) => {
      const trimmed = answer.trim();
      resolve(trimmed !== '' ? trimmed : (defaultValue ?? ''));
    });
  });
}

export function questionWithDefault(
  readline: ReturnType<typeof createInterface>,
  prompt: string,
  defaultValue: string,
): Promise<string> {
  return question(readline, prompt, defaultValue);
}

/**
 * Prompt for a secret value WITHOUT echoing it to the terminal (password-style).
 * The prompt text is printed; typed characters are suppressed. Returns the trimmed
 * value (empty string if the user just pressed Enter).
 */
export function questionHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    // Suppress echo of typed characters — the prompt is already printed above.
    (readline as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = () => {};
    readline.question('', (answer) => {
      readline.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

/**
 * A step that needs the user to fetch a value from an external dashboard.
 *
 * `url` is auto-copied to the system clipboard so the user only has to paste it
 * into the browser; `steps` are printed as an exact numbered checklist.
 */
export interface LinkStepOptions {
  /** One-line title of what this value is and why it is needed. */
  title: string;
  /** The dashboard URL to copy to the clipboard. */
  url: string;
  /** Exact, ordered actions the user performs on that page. */
  steps: string[];
}

/**
 * Print an exact step-by-step block for a value the user must fetch, and copy
 * its link to the clipboard with a prominent "link copied" confirmation.
 *
 * @remarks
 * The clipboard is the primary focus: when a clipboard tool is present the URL
 * is placed there and the user is told to just paste it — the link is still
 * printed as a fallback. No clipboard tool → it degrades to printing the link.
 */
export function presentLinkStep({ title, url, steps }: LinkStepOptions): void {
  logger.blank();
  logger.info(`▸ ${title}`);
  logger.instruction(steps);
  if (clipboardAvailable() && copyToClipboard(url)) {
    logger.blank();
    logger.success(
      '🔗  Link copied to your clipboard — just paste it (⌘V / Ctrl+V) in your browser:',
    );
    logger.info(`    ${url}`);
  } else {
    logger.blank();
    logger.info(`🔗  Open this link in your browser: ${url}`);
  }
  logger.blank();
}
