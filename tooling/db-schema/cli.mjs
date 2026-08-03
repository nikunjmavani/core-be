#!/usr/bin/env node
// Local db schema CLI for core-be.
//
//   pnpm db:schema
//   node tooling/db-schema/cli.mjs --no-open
//   DB_SCHEMA_PORT=4990 pnpm db:schema

import { resolveProject, DEFAULT_PORT } from './lib/project.mjs';
import { startServer } from './server.mjs';

function usage() {
  console.log(`
  db schema — local Drizzle ER canvas (core-be tooling)

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
`);
}

function parseArgs(argv) {
  const out = {
    port: null,
    schema: null,
    migrations: null,
    open: true,
    fresh: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') out.help = true;
    else if (a === '--no-open') out.open = false;
    else if (a === '--open') out.open = true;
    else if (a === '--fresh') out.fresh = true;
    else if (a === '--port' || a === '-p') out.port = Number(argv[++i]);
    else if (a === '--schema') out.schema = argv[++i];
    else if (a === '--migrations') out.migrations = argv[++i];
    else {
      console.error(`Unknown argument: ${a}`);
      out.help = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    process.exit(0);
  }

  const project = resolveProject({
    cwd: process.cwd(),
    schema: args.schema || undefined,
    migrations: args.migrations || undefined,
    port: args.port || undefined,
  });

  if (!project.schemaTarget) {
    console.error(`
  db schema: could not find a Drizzle schema under ${project.root}

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
