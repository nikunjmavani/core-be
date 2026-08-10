#!/usr/bin/env node
// DB Viewer CLI for this project.
//
//   pnpm db:viewer
//   node tooling/db-viewer/cli.mjs --no-open
//   DB_VIEWER_PORT=4990 pnpm db:viewer
//   DB_VIEWER_REVIEW=1 pnpm db:viewer   # opt-in Claude review endpoint

import { resolveProject, DEFAULT_PORT } from './lib/project.mjs';
import { startServer } from './server.mjs';

function usage() {
  console.log(`
  DB Viewer — local Drizzle ER canvas (repo tooling)

  Usage:
    pnpm db:viewer
    node tooling/db-viewer/cli.mjs [options]

  Options:
    -p, --port <n>         Port (default ${DEFAULT_PORT}, or DB_VIEWER_PORT / config.json)
    --schema <path>        Schema file or folder (relative to project root)
    --migrations <path>    Migrations folder with .sql files
    --no-open              Do not open the browser
    --open                 Open the browser (default)
    --fresh                Ignore saved version history (save mode)
    -h, --help             Show help

  Env:
    DB_VIEWER_PORT=4990    Override port
    DB_VIEWER_REVIEW=1     Enable POST /api/review (loopback + Origin checks; spawns claude)
`);
}

function takeValue(argv, i, flag) {
  const v = argv[i + 1];
  if (v == null || v.startsWith('-')) {
    console.error(`Missing value for ${flag}`);
    return { error: true, value: null, next: i };
  }
  return { error: false, value: v, next: i + 1 };
}

/**
 * Switches that take no value. Keyed by flag; each applies its effect to the
 * accumulating result.
 *
 * A Map rather than an object literal so an argument like `--constructor`
 * cannot resolve to an inherited `Object.prototype` member.
 */
const BOOLEAN_FLAGS = new Map([
  ['-h', ['help', true]],
  ['--help', ['help', true]],
  ['--no-open', ['open', false]],
  ['--open', ['open', true]],
  ['--fresh', ['fresh', true]],
]);

/** Options that consume the following argv entry, keyed by flag → result property. */
const VALUE_OPTIONS = new Map([
  ['--port', 'port'],
  ['-p', 'port'],
  ['--schema', 'schema'],
  ['--migrations', 'migrations'],
]);

/** A bad argument aborts startup and prints usage. */
function rejectArgs(out) {
  out.bad = true;
  out.help = true;
}

function parseArgs(argv) {
  const out = {
    port: null,
    schema: null,
    migrations: null,
    open: true,
    fresh: false,
    help: false,
    bad: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    const booleanFlag = BOOLEAN_FLAGS.get(a);
    if (booleanFlag) {
      const [property, value] = booleanFlag;
      out[property] = value;
      continue;
    }

    const property = VALUE_OPTIONS.get(a);
    if (!property) {
      console.error(`Unknown argument: ${a}`);
      rejectArgs(out);
      continue;
    }

    const { error, value, next } = takeValue(argv, i, a);
    i = next;
    if (error) {
      rejectArgs(out);
      continue;
    }

    if (property !== 'port') {
      out[property] = value;
      continue;
    }

    const port = Number(value);
    if (Number.isFinite(port) && port > 0) {
      out.port = port;
    } else {
      console.error(`Invalid port: ${value}`);
      rejectArgs(out);
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(args.bad ? 1 : 0);
  }

  const project = resolveProject({
    cwd: process.cwd(),
    schema: args.schema || undefined,
    migrations: args.migrations || undefined,
    port: args.port || undefined,
  });

  if (project.configError) {
    console.error(`\n  DB Viewer: ${project.configError}\n`);
    process.exit(1);
  }

  if (!project.schemaTarget) {
    console.error(`
  DB Viewer: could not find a Drizzle schema under ${project.root}

  Check tooling/db-viewer/config.json, or pass --schema / --migrations.
`);
    process.exit(1);
  }

  startServer({
    schemaTarget: project.schemaTarget,
    migrationsDir: project.migrationsDir,
    port: args.port || project.port,
    fresh: args.fresh,
    open: args.open,
    projectName: project.name,
    projectRoot: project.root,
  });
}

main();
