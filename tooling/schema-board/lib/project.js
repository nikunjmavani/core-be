// Resolve schema + migrations roots for any Drizzle project (cwd-aware).
// Order: schema-board.config.json → drizzle.config hint → conventional layout.

'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_NAMES = ['schema-board.config.json', '.schema-board.json'];
const DRIZZLE_CONFIG_NAMES = [
  'drizzle.config.ts',
  'drizzle.config.js',
  'drizzle.config.mts',
  'drizzle.config.mjs',
  'drizzle.config.cjs',
];

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function isDir(p) {
  try { return exists(p) && fs.statSync(p).isDirectory(); } catch { return false; }
}

function hasSqlMigrations(dir) {
  if (!isDir(dir)) return false;
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith('.sql'));
  } catch { return false; }
}

function hasSchemaFiles(dir) {
  if (!isDir(dir)) return false;
  const stack = [dir];
  let seen = 0;
  while (stack.length && seen < 400) {
    const d = stack.pop();
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === 'dist' || ent.name === 'coverage') continue;
      const full = path.join(d, ent.name);
      if (ent.isDirectory()) { stack.push(full); continue; }
      if (!ent.isFile()) continue;
      seen++;
      const base = ent.name;
      if (base.endsWith('.job.schema.ts') || base.endsWith('.d.ts')) continue;
      if (base.endsWith('.schema.ts') || base === 'pg-schemas.ts' || base === 'schema.ts') return true;
    }
  }
  return false;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function packageName(root) {
  const pkg = readJson(path.join(root, 'package.json'));
  return (pkg && pkg.name) || path.basename(root);
}

/** Walk up from start looking for a config file or package.json project root. */
function findProjectRoot(start) {
  let dir = path.resolve(start || process.cwd());
  const { root } = path.parse(dir);
  let pkgRoot = null;
  while (true) {
    for (const name of CONFIG_NAMES) {
      const cfg = path.join(dir, name);
      if (exists(cfg)) return { root: dir, configPath: cfg };
    }
    if (!pkgRoot && exists(path.join(dir, 'package.json'))) pkgRoot = dir;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return { root: pkgRoot || path.resolve(start || process.cwd()), configPath: null };
}

function detectMigrations(root, schemaTarget) {
  const base = isDir(schemaTarget) ? schemaTarget : path.dirname(schemaTarget);
  const candidates = [
    path.join(root, 'migrations'),
    path.join(base, 'migrations'),
    path.join(base, '..', 'migrations'),
  ];
  for (const c of candidates) {
    if (hasSqlMigrations(c)) return path.resolve(c);
  }
  return null;
}

function hasDrizzleConfig(root) {
  return DRIZZLE_CONFIG_NAMES.some((name) => exists(path.join(root, name)));
}

function detectSchema(root) {
  const candidates = [
    path.join(root, 'src'),
    path.join(root, 'schema'),
    path.join(root, 'src', 'db'),
    path.join(root, 'src', 'database'),
    path.join(root, 'db'),
    path.join(root, 'schema.ts'),
    path.join(root, 'src', 'schema.ts'),
  ];
  for (const c of candidates) {
    if (isDir(c) && hasSchemaFiles(c)) return path.resolve(c);
    if (exists(c) && !isDir(c) && /\.(ts|js|mts|cts)$/.test(c)) return path.resolve(c);
  }
  // drizzle.config present → prefer conventional ./src (core-be style; ignore kit `out/`)
  if (hasDrizzleConfig(root) && isDir(path.join(root, 'src'))) {
    return path.resolve(root, 'src');
  }
  return null;
}

/**
 * Resolve a project board target.
 * @param {{ cwd?: string, projectRoot?: string, schema?: string, migrations?: string, port?: number, name?: string }} opts
 */
function resolveProject(opts = {}) {
  const start = opts.projectRoot
    ? path.resolve(opts.projectRoot)
    : path.resolve(opts.cwd || process.cwd());

  const { root, configPath } = findProjectRoot(start);
  let cfg = {};
  if (configPath) cfg = readJson(configPath) || {};

  const name = opts.name || cfg.name || packageName(root);
  const port = Number(opts.port || cfg.port || 4000) || 4000;

  let schemaTarget = opts.schema || cfg.schema || null;
  if (schemaTarget) schemaTarget = path.resolve(root, schemaTarget);
  else schemaTarget = detectSchema(root);

  let migrationsDir = opts.migrations || cfg.migrations || null;
  if (migrationsDir) migrationsDir = path.resolve(root, migrationsDir);
  else if (schemaTarget) migrationsDir = detectMigrations(root, schemaTarget);
  else if (hasDrizzleConfig(root) && hasSqlMigrations(path.join(root, 'migrations'))) {
    // drizzle.config hint: hand-written migrations/ at project root (not kit out/)
    migrationsDir = path.resolve(root, 'migrations');
    if (!schemaTarget && isDir(path.join(root, 'src'))) {
      schemaTarget = path.resolve(root, 'src');
    }
  }

  if (migrationsDir && !hasSqlMigrations(migrationsDir)) migrationsDir = null;

  let source = 'none';
  if (configPath) source = 'config';
  else if (schemaTarget && hasDrizzleConfig(root)) source = 'drizzle-config';
  else if (schemaTarget) source = 'detect';

  return {
    root,
    name,
    port,
    schemaTarget,
    migrationsDir,
    configPath,
    source,
  };
}

module.exports = {
  resolveProject,
  findProjectRoot,
  hasSqlMigrations,
  hasSchemaFiles,
  detectMigrations,
  detectSchema,
};
