#!/usr/bin/env node
// schema·board CLI — open the ER board for the current (or given) Drizzle project.
//
//   schema-board                  # detect from cwd, serve, open browser
//   schema-board --no-open        # server only
//   schema-board -p 4001
//   schema-board path/to/project
//   schema-board --schema ./src --migrations ./migrations

'use strict';

const path = require('path');
const { resolveProject } = require('../lib/project');
const { startServer } = require('../server');

function usage() {
  console.log(`
  schema·board — live Drizzle ER canvas for any project

  Usage:
    schema-board [project-root] [options]

  Options:
    -p, --port <n>         Port (default 4000 or config)
    --schema <path>        Schema file or folder (relative to project)
    --migrations <path>    Migrations folder with .sql files
    --no-open              Do not open the browser
    --open                 Open the browser (default)
    --fresh                Ignore saved version history (save mode)
    -h, --help             Show help
`);
}

function parseArgs(argv) {
  const out = {
    projectRoot: null,
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
    else if (!a.startsWith('-') && !out.projectRoot) out.projectRoot = a;
    else {
      console.error(`Unknown argument: ${a}`);
      out.help = true;
    }
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { usage(); process.exit(0); }

  const project = resolveProject({
    projectRoot: args.projectRoot || undefined,
    cwd: process.cwd(),
    schema: args.schema || undefined,
    migrations: args.migrations || undefined,
    port: args.port || undefined,
  });

  if (!project.schemaTarget) {
    console.error(`
  schema·board: could not find a Drizzle schema under ${project.root}

  Add schema-board.config.json:
    { "name": "my-app", "schema": "./src", "migrations": "./migrations" }

  Or pass --schema / --migrations explicitly.
`);
    process.exit(1);
  }

  const port = args.port || project.port;
  startServer({
    schemaTarget: project.schemaTarget,
    migrationsDir: project.migrationsDir,
    port,
    fresh: args.fresh,
    open: args.open,
    projectName: project.name,
    projectRoot: project.root,
  });
}

main();
