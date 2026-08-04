#!/usr/bin/env node
// DB Schema Viewer CLI for core-be.
//
//   pnpm db:schema
//   node tooling/db-schema/cli.mjs --no-open
//   DB_SCHEMA_PORT=4990 pnpm db:schema
//   DB_SCHEMA_REVIEW=1 pnpm db:schema   # opt-in Claude review endpoint

import { resolveProject, DEFAULT_PORT } from './lib/project.mjs';
import { startServer } from './server.mjs';

function usage() {
  console.log(`
  DB Schema Viewer — local Drizzle ER canvas (core-be tooling)

  Usage:
    pnpm db:schema
    node tooling/db-schema/cli.mjs [options]

  Options:
    -p, --port <n>         Port (default ${DEFAULT_PORT}, or DB_SCHEMA_PORT / config.json)
    --schema <path>        Schema file or folder (relative to project root)
    --migrations <path>    Migrations folder with .sql files
    --no-open              Do not open the browser
    --open                 Open the browser (default)
    --fresh                Ignore saved version history (save mode)
    -h, --help             Show help

  Env:
    DB_SCHEMA_PORT=4990    Override port
    DB_SCHEMA_REVIEW=1     Enable POST /api/review (loopback + Origin checks; spawns claude)
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
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--no-open') out.open = false;
    else if (a === '--open') out.open = true;
    else if (a === '--fresh') out.fresh = true;
    else if (a === '--port' || a === '-p') {
      const { error, value, next } = takeValue(argv, i, a);
      i = next;
      if (error) {
        out.bad = true;
        out.help = true;
        continue;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`Invalid port: ${value}`);
        out.bad = true;
        out.help = true;
      } else out.port = n;
    } else if (a === '--schema') {
      const { error, value, next } = takeValue(argv, i, a);
      i = next;
      if (error) {
        out.bad = true;
        out.help = true;
      } else out.schema = value;
    } else if (a === '--migrations') {
      const { error, value, next } = takeValue(argv, i, a);
      i = next;
      if (error) {
        out.bad = true;
        out.help = true;
      } else out.migrations = value;
    } else {
      console.error(`Unknown argument: ${a}`);
      out.bad = true;
      out.help = true;
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
    console.error(`\n  DB Schema Viewer: ${project.configError}\n`);
    process.exit(1);
  }

  if (!project.schemaTarget) {
    console.error(`
  DB Schema Viewer: could not find a Drizzle schema under ${project.root}

  Check tooling/db-schema/config.json, or pass --schema / --migrations.
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
