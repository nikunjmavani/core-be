/**
 * Add a new environment variable to both the Zod schema AND .env.example.
 *
 * Usage:
 *   pnpm env:add KEY_NAME --type string --section secret --desc "Description"
 *   pnpm env:add KEY_NAME --type number --section variable --default 3000
 *   pnpm env:add KEY_NAME --type boolean --section variable --default true
 *   pnpm env:add                         (interactive mode)
 *
 * Types: string | number | boolean
 * Section: secret | variable
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';

const PROJECT_ROOT = resolve(import.meta.dirname, '../../../');
const SCHEMA_PATH = resolve(PROJECT_ROOT, 'src/shared/config/env-schema.ts');
const ENV_EXAMPLE_PATH = resolve(PROJECT_ROOT, '.env.example');

interface AddEnvOptions {
  key: string;
  type: 'string' | 'number' | 'boolean';
  section: 'secret' | 'variable';
  description: string;
  defaultValue?: string;
  optional: boolean;
}

function parseArgs(): AddEnvOptions | null {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log('Usage: pnpm env:add <KEY_NAME> [options]');
    console.log('');
    console.log('Options:');
    console.log('  --type <string|number|boolean>  Zod type (default: string)');
    console.log('  --section <secret|variable>     GitHub half (default: variable)');
    console.log('  --desc <text>                   Description comment');
    console.log('  --default <value>               Default value (makes it optional)');
    console.log('  --required                      Mark as required (no .optional())');
    console.log('');
    console.log('Run without args for interactive mode.');
    return null;
  }

  const key = args[0];
  if (key === undefined) {
    return null;
  }
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    console.error(`Invalid key name "${key}". Must be SCREAMING_SNAKE_CASE.`);
    return null;
  }

  const getFlag = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx >= 0 ? args[idx + 1] : undefined;
  };

  const type = (getFlag('--type') ?? 'string') as AddEnvOptions['type'];
  if (!['string', 'number', 'boolean'].includes(type)) {
    console.error('--type must be string, number, or boolean');
    return null;
  }

  const section = (getFlag('--section') ?? 'variable') as AddEnvOptions['section'];
  if (!['secret', 'variable'].includes(section)) {
    console.error('--section must be secret or variable');
    return null;
  }

  const defaultValue = getFlag('--default');

  return {
    key,
    type,
    section,
    description: getFlag('--desc') ?? '',
    optional: !args.includes('--required'),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

async function interactivePrompt(): Promise<AddEnvOptions> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  console.log('Add a new environment variable');
  console.log('');

  const key = await rl.question('Key name (SCREAMING_SNAKE_CASE): ');
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    console.error(`Invalid key name "${key}". Must be SCREAMING_SNAKE_CASE.`);
    process.exit(1);
  }

  const typeAnswer = await rl.question('Type [string/number/boolean] (default: string): ');
  const type = (typeAnswer.trim() || 'string') as AddEnvOptions['type'];

  const sectionAnswer = await rl.question('GitHub half [secret/variable] (default: variable): ');
  const section = (sectionAnswer.trim() || 'variable') as AddEnvOptions['section'];

  const desc = await rl.question('Description (optional): ');

  const defaultAnswer = await rl.question(
    'Default value (optional, makes it optional in schema): ',
  );
  const requiredAnswer = await rl.question('Required? [y/N]: ');

  rl.close();

  const defaultValue = defaultAnswer.trim() || undefined;

  return {
    key: key.trim(),
    type,
    section,
    description: desc.trim(),
    optional: requiredAnswer.trim().toLowerCase() !== 'y',
    ...(defaultValue !== undefined ? { defaultValue } : {}),
  };
}

function buildZodField(options: AddEnvOptions): string {
  let field: string;

  switch (options.type) {
    case 'number':
      field = `z.coerce.number().int()`;
      break;
    case 'boolean':
      // booleanString helper
      if (options.defaultValue) {
        const d = options.defaultValue === 'true' ? 'true' : 'false';
        return [
          `  /** ${options.description || options.key} */`,
          `  ${options.key}: booleanString('${d}'),`,
        ].join('\n');
      }
      field = `z.string().optional().default('false').transform((v) => v === 'true' || v === '1')`;
      return `  /** ${options.description || options.key} */\n  ${options.key}: ${field},`;
    default:
      field = `z.string().min(1)`;
      break;
  }

  if (options.optional && !options.defaultValue) {
    field += `.optional()`;
  }
  if (options.defaultValue) {
    if (options.type === 'number') {
      field += `.default(${options.defaultValue})`;
    } else {
      field += `.default('${options.defaultValue}')`;
    }
  }

  return `  /** ${options.description || options.key} */\n  ${options.key}: ${field},`;
}

function addToSchema(options: AddEnvOptions): boolean {
  if (!existsSync(SCHEMA_PATH)) {
    console.error(`Schema not found: ${SCHEMA_PATH}`);
    return false;
  }

  let content = readFileSync(SCHEMA_PATH, 'utf-8');

  // Check if key already exists
  if (new RegExp(`\\b${options.key}:`).test(content)) {
    console.error(`Key ${options.key} already exists in env-schema.ts.`);
    return false;
  }

  const field = buildZodField(options);

  // Insert before the closing `});` of envSchemaBase
  const closingMarker = '});';
  const lastClosing = content.lastIndexOf(closingMarker);
  if (lastClosing === -1) {
    console.error('Could not find insertion point in env-schema.ts.');
    return false;
  }

  // Find the start of the line containing the last closing
  const lineStart = content.lastIndexOf('\n', lastClosing);
  const insertAt = lineStart === -1 ? lastClosing : lineStart;

  content = `${content.slice(0, insertAt)}\n${field}\n${content.slice(insertAt)}`;
  writeFileSync(SCHEMA_PATH, content, 'utf-8');
  console.log(`  + Added ${options.key} to env-schema.ts`);
  return true;
}

function addToEnvExample(options: AddEnvOptions): boolean {
  if (!existsSync(ENV_EXAMPLE_PATH)) {
    console.error(`.env.example not found: ${ENV_EXAMPLE_PATH}`);
    return false;
  }

  let content = readFileSync(ENV_EXAMPLE_PATH, 'utf-8');

  // Check if key already exists
  const keyRegex = new RegExp(`^#?\\s*${options.key}=`, 'm');
  if (keyRegex.test(content)) {
    console.error(`Key ${options.key} already exists in .env.example.`);
    return false;
  }

  const halfBanner = options.section === 'secret' ? '# GitHub Secrets' : '# GitHub Variables';
  const otherHalfBanner = options.section === 'secret' ? '# GitHub Variables' : '# GitHub Secrets';

  // Find the right half and insert before the next half or at end
  const halfIdx = content.indexOf(halfBanner);
  if (halfIdx === -1) {
    console.error(`Could not find "${halfBanner}" section in .env.example.`);
    return false;
  }

  // Find the next half after this one (or end of file)
  const nextHalfIdx = content.indexOf(otherHalfBanner, halfIdx + halfBanner.length);
  const insertAt = nextHalfIdx === -1 ? content.length : nextHalfIdx;

  const descLine = options.description ? `# ${options.description}\n` : '';
  const defaultValue =
    options.defaultValue ??
    (options.type === 'number' ? '0' : options.type === 'boolean' ? 'false' : '');
  const entry = `\n${descLine}${options.key}=${defaultValue}\n`;

  content = content.slice(0, insertAt) + entry + content.slice(insertAt);
  writeFileSync(ENV_EXAMPLE_PATH, content, 'utf-8');
  console.log(`  + Added ${options.key} to .env.example under "${halfBanner}"`);
  return true;
}

async function main(): Promise<void> {
  let options = parseArgs();

  if (options === null && process.argv.slice(2).length > 0) {
    // Had args but parsing failed (e.g. --help)
    if (process.argv.includes('--help') || process.argv.includes('-h')) {
      process.exit(0);
    }
    process.exit(1);
  }

  if (options === null) {
    options = await interactivePrompt();
  }

  console.log('');
  console.log(`Adding env var: ${options.key}`);
  console.log(`  Type:        ${options.type}`);
  console.log(`  Section:     ${options.section}`);
  console.log(`  Optional:    ${options.optional}`);
  if (options.defaultValue) console.log(`  Default:     ${options.defaultValue}`);
  if (options.description) console.log(`  Description: ${options.description}`);
  console.log('');

  const schemaOk = addToSchema(options);
  const exampleOk = addToEnvExample(options);

  if (schemaOk && exampleOk) {
    console.log('');
    console.log('Done. Next steps:');
    console.log(`  1. Review the changes in ${SCHEMA_PATH} and ${ENV_EXAMPLE_PATH}`);
    console.log('  2. Run: pnpm tool:sync-env-example');
    console.log('  3. Run: pnpm envs:sync:local   (to add to .env.<environment> files)');
    console.log('  4. Run: pnpm envs:sync:github  (to push to GitHub Environments)');
  } else {
    process.exit(1);
  }
}

main();
