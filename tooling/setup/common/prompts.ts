import { createInterface } from 'node:readline';

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
