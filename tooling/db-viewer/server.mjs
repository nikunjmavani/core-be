#!/usr/bin/env node
// Local ER board for Drizzle schemas + migrations/*.sql (tooling/db-viewer).
// Prefer: pnpm db:viewer

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseSchema } from './lib/parser.mjs';
import { diffSchemas } from './lib/diff.mjs';
import { buildMigrationVersions, cloneSchema } from './lib/sql-migrations.mjs';
import { openUrl } from './lib/open.mjs';
import { DEFAULT_PORT } from './lib/project.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MAX_SAVE_VERSIONS = 40;
const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
};

function detectSiblingMigrations(schemaTarget) {
  const base =
    fs.existsSync(schemaTarget) && fs.statSync(schemaTarget).isDirectory()
      ? schemaTarget
      : path.dirname(schemaTarget);
  const candidates = [path.join(base, 'migrations'), path.join(base, '..', 'migrations')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) {
      const hasSql = fs.readdirSync(c).some((f) => f.endsWith('.sql'));
      if (hasSql) return path.resolve(c);
    }
  }
  return null;
}

/** Directories skipped when scanning a schema target. */
const SKIPPED_WALK_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'coverage']);

/** Recursively collect every file under `dir` into `out`. */
function walkFiles(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SKIPPED_WALK_DIRECTORIES.has(ent.name)) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(full, out);
    else if (ent.isFile()) out.push(full);
  }
}

/**
 * The schema files a target resolves to.
 *
 * A file target is used as-is. A directory prefers `*.schema.ts` / `pg-schemas.ts`
 * anywhere beneath it, and otherwise falls back to the directly-contained
 * TypeScript sources.
 */
function collectSchemaFiles(t) {
  const stat = fs.existsSync(t) ? fs.statSync(t) : null;
  if (!stat) return [];
  if (!stat.isDirectory()) return [t];

  const all = [];
  walkFiles(t, all);
  const schemaFiles = all.filter((f) => {
    const base = path.basename(f);
    if (base.endsWith('.job.schema.ts') || base.endsWith('.d.ts')) return false;
    return base.endsWith('.schema.ts') || base === 'pg-schemas.ts';
  });
  if (schemaFiles.length) return schemaFiles.sort();
  return all
    .filter((f) => /\.(ts|js|mts|cts)$/.test(f) && !f.endsWith('.d.ts') && path.dirname(f) === t)
    .sort();
}

/** Concatenated source of every schema file under `target`; unreadable files are skipped. */
function readAllSchemaSource(target) {
  return collectSchemaFiles(target)
    .map((f) => {
      try {
        return fs.readFileSync(f, 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n\n');
}

/**
 * Order-independent fingerprint of a schema, used to detect "nothing actually
 * changed" before pushing a new version.
 */
function stableStringify(schema) {
  return JSON.stringify({
    tables: (schema.tables || []).map((t) => ({
      schema: t.schema || 'public',
      name: t.name,
      cols: t.columns.map(
        (c) =>
          c.key +
          c.type +
          c.pk +
          c.notNull +
          c.unique +
          c.default +
          (c.length ?? '') +
          JSON.stringify(c.references),
      ),
    })),
    enums: schema.enums,
  });
}

/**
 * Start the db schema HTTP server.
 * @param {{
 *   schemaTarget: string,
 *   migrationsDir?: string|null,
 *   port?: number,
 *   fresh?: boolean,
 *   open?: boolean,
 *   projectName?: string|null,
 *   projectRoot?: string|null,
 * }} opts
 */
function startServer(opts = {}) {
  const target = path.resolve(opts.schemaTarget);
  const port = Number(opts.port) || DEFAULT_PORT;
  const fresh = !!opts.fresh;
  const migrationsDir = opts.migrationsDir
    ? path.resolve(opts.migrationsDir)
    : detectSiblingMigrations(target);
  const projectName = opts.projectName || null;
  const projectRoot = opts.projectRoot ? path.resolve(opts.projectRoot) : null;
  const shouldOpen = !!opts.open;
  const migrationMode = !!(migrationsDir && fs.existsSync(migrationsDir));

  // ---- schema sources -------------------------------------------------------
  function parseDrizzleSchema() {
    const source = readAllSchemaSource(target);
    if (!source.trim()) return { dialect: 'postgres', enums: [], tables: [], relations: [] };
    return parseSchema(source);
  }

  // ---- version history ------------------------------------------------------
  let versions = [];
  let clients = [];
  let seq = 0;

  const historyDir = path.join(__dirname, '.db-viewer-history');
  const historyFile = path.join(
    historyDir,
    'history-' +
      target
        .replace(/[^a-zA-Z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) +
      '.json',
  );
  let skippedStatements = 0;
  let reviewInFlight = false;
  const BIND_HOST = '127.0.0.1';
  const reviewEnabled = process.env.DB_VIEWER_REVIEW === '1';
  // Loopback is shared by every local user/process: a per-boot random token — embedded in
  // the URL the CLI prints/opens — gates /api/* and /events so an unrelated local process
  // cannot read the schema or trigger reviews (token spend).
  const sessionToken = randomBytes(16).toString('hex');

  function isValidSessionToken(provided) {
    if (typeof provided !== 'string' || provided.length !== sessionToken.length) return false;
    return timingSafeEqual(Buffer.from(provided), Buffer.from(sessionToken));
  }

  function loadHistory() {
    if (fresh || migrationMode) return;
    try {
      const raw = JSON.parse(fs.readFileSync(historyFile, 'utf8'));
      if (Array.isArray(raw.versions)) {
        for (const v of raw.versions) {
          if (Array.isArray(v?.schema?.tables)) versions.push(v);
        }
        seq = versions.reduce((m, v) => Math.max(m, v.id), 0);
      }
    } catch {
      /* no prior history */
    }
  }

  let saveTimer = null;
  function saveHistory() {
    if (migrationMode) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        fs.mkdirSync(historyDir, { recursive: true });
        fs.writeFileSync(historyFile, JSON.stringify({ target, versions }));
      } catch {
        /* best effort */
      }
    }, 200);
  }

  function displayTarget() {
    if (projectName) return projectName;
    const relBase = projectRoot || process.cwd();
    return path.relative(relBase, target) || target;
  }

  function buildPayload() {
    const list = versions.map((v) => ({
      id: v.id,
      at: v.at,
      reason: v.reason,
      tables: v.schema.tables.length,
      kind: v.kind || 'save',
      file: v.file || null,
      structural: v.structural !== false,
    }));
    const current = versions[versions.length - 1];
    const prev = versions[versions.length - 2];
    const diff = current ? diffSchemas(prev ? prev.schema : { tables: [] }, current.schema) : null;
    if (
      diff &&
      !diff.changelog?.length &&
      current.kind === 'migration' &&
      current.structural === false
    ) {
      diff.note = 'No structural table/column changes (RLS / index / function)';
    }
    return {
      versions: list,
      current: current ? current.id : null,
      diff,
      target: displayTarget(),
      projectName,
      migrationMode,
      skippedStatements,
      reviewEnabled,
      migrationsDir: migrationMode
        ? path.relative(projectRoot || process.cwd(), migrationsDir) || migrationsDir
        : null,
    };
  }

  function broadcast(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    clients = clients.filter((res) => {
      try {
        res.write(payload);
        return true;
      } catch {
        return false;
      }
    });
  }

  // ---- migration mode -------------------------------------------------------
  function rebuildMigrationVersions() {
    const built = buildMigrationVersions(migrationsDir);
    const migs = built.versions || built; // tolerate legacy array return
    skippedStatements =
      (migs || []).reduce((n, v) => n + (v.skipped || 0), 0) + (built.unreadFiles || 0);
    let drizzle;
    try {
      drizzle = parseDrizzleSchema();
    } catch (e) {
      broadcast('parse-error', { message: String(e?.message || e) });
      drizzle = migs.length
        ? cloneSchema(migs[migs.length - 1].schema)
        : { dialect: 'postgres', enums: [], tables: [], relations: [] };
    }
    const tipId = migs.length + 1;
    versions = [
      ...migs,
      {
        id: tipId,
        at: new Date().toISOString(),
        reason: 'Latest',
        kind: 'latest',
        file: null,
        structural: true,
        schema: drizzle,
      },
    ];
    seq = tipId;
    broadcast('version', buildPayload());
  }

  function refreshLatestOnly() {
    if (!migrationMode) return;
    let drizzle;
    try {
      drizzle = parseDrizzleSchema();
    } catch (e) {
      broadcast('parse-error', { message: String(e?.message || e) });
      return;
    }
    const tip = versions[versions.length - 1];
    if (tip && tip.kind === 'latest') {
      if (stableStringify(tip.schema) === stableStringify(drizzle)) return;
      tip.schema = drizzle;
      tip.at = new Date().toISOString();
    } else {
      versions.push({
        id: ++seq,
        at: new Date().toISOString(),
        reason: 'Latest',
        kind: 'latest',
        structural: true,
        schema: drizzle,
      });
    }
    broadcast('version', buildPayload());
  }

  // ---- demo / save-history mode ---------------------------------------------
  function snapshot(reason) {
    const source = readAllSchemaSource(target);
    if (!source.trim()) return;
    let schema;
    try {
      schema = parseSchema(source);
    } catch (e) {
      broadcast('parse-error', { message: String(e?.message || e) });
      return;
    }

    const last = versions[versions.length - 1];
    if (last && stableStringify(last.schema) === stableStringify(schema)) return;

    const id = ++seq;
    const at = new Date().toISOString();
    versions.push({ id, at, schema, reason, kind: 'save', structural: true });
    if (versions.length > MAX_SAVE_VERSIONS) versions.shift();
    saveHistory();
    broadcast('version', buildPayload());
  }

  // ---- file watching (debounced) --------------------------------------------
  let debounceSchema = null;
  let debounceMig = null;

  function watchPath(dir, recursive, onEvt) {
    try {
      fs.watch(dir, { recursive }, onEvt);
    } catch {
      try {
        fs.watch(dir, onEvt);
      } catch {
        /* ignore */
      }
    }
  }

  function watch() {
    const isDir = fs.existsSync(target) && fs.statSync(target).isDirectory();
    const watchTarget = isDir ? target : path.dirname(target);

    watchPath(watchTarget, true, (_ev, filename) => {
      if (filename && /\.(job\.schema\.ts|d\.ts)$/.test(filename)) return;
      if (filename && !/\.(ts|js|mts|cts)$/.test(filename) && !/schema/i.test(filename)) return;
      clearTimeout(debounceSchema);
      debounceSchema = setTimeout(() => {
        if (migrationMode) refreshLatestOnly();
        else snapshot('file changed');
      }, 120);
    });

    if (migrationMode) {
      watchPath(migrationsDir, false, (_ev, filename) => {
        if (filename && !filename.endsWith('.sql')) return;
        clearTimeout(debounceMig);
        debounceMig = setTimeout(() => rebuildMigrationVersions(), 200);
      });
    }
  }

  // ---- static + api ---------------------------------------------------------
  const publicDir = path.join(__dirname, 'public');

  function parseRequestUrl(req) {
    const raw = req.url || '/';
    const q = raw.indexOf('?');
    const pathname = q === -1 ? raw : raw.slice(0, q);
    const search = q === -1 ? '' : raw.slice(q + 1);
    return { pathname, searchParams: new URLSearchParams(search) };
  }

  function json(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  }

  function isLocalOrigin(origin, portNum) {
    if (!origin) return true; // same-origin / non-browser clients omit Origin
    try {
      const u = new URL(origin);
      const hostOk = u.hostname === '127.0.0.1' || u.hostname === 'localhost';
      const portOk = !u.port || Number(u.port) === Number(portNum);
      return hostOk && portOk && (u.protocol === 'http:' || u.protocol === 'https:');
    } catch {
      return false;
    }
  }

  function isLocalHostHeader(host, portNum) {
    if (!host || typeof host !== 'string') return false;
    const h = host.trim().toLowerCase();
    return (
      h === `127.0.0.1:${portNum}` ||
      h === `localhost:${portNum}` ||
      h === '127.0.0.1' ||
      h === 'localhost'
    );
  }

  function childEnvAllowlist() {
    const allow = ['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'];
    const env = {};
    for (const k of allow) if (process.env[k] != null) env[k] = process.env[k];
    // Optional Claude-related vars only — never pass DATABASE_URL / secrets.
    for (const [k, v] of Object.entries(process.env)) {
      if (/^CLAUDE_/i.test(k) && v != null) env[k] = v;
    }
    return env;
  }

  /**
   * DNS-rebinding, origin and session-token guards for every non-static path.
   *
   * Returns true when the request was rejected and a response already sent.
   */
  function rejectUntrustedRequest(req, res, pathname, searchParams) {
    if (!(pathname.startsWith('/api/') || pathname === '/events')) return false;

    if (!isLocalHostHeader(req.headers.host, port)) {
      json(res, 403, { error: 'Invalid Host' });
      return true;
    }
    if (!isLocalOrigin(req.headers.origin, port)) {
      json(res, 403, { error: 'Origin not allowed' });
      return true;
    }
    // Query param because EventSource cannot set headers; header kept for curl ergonomics.
    const provided = req.headers['x-session-token'] || searchParams.get('token') || '';
    if (!isValidSessionToken(provided)) {
      json(res, 403, { error: 'Missing or invalid session token' });
      return true;
    }
    return false;
  }

  /** SSE stream: push the current payload, then every later broadcast. */
  function handleEventsStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.push(res);
    res.write(`event: version\ndata: ${JSON.stringify(buildPayload())}\n\n`);
    req.on('close', () => {
      clients = clients.filter((c) => c !== res);
    });
  }

  /**
   * Spawn the reviewer for `sql` and answer with its output.
   *
   * Always clears `reviewInFlight`, on every exit path — a stuck flag would
   * lock out reviews until the server restarts.
   */
  function runSchemaReview(res, sql) {
    const prompt = [
      'You are a senior database engineer. Review this Postgres/Drizzle schema for correctness, data integrity, indexing, normalization, naming, and likely footguns.',
      'Give concise, high-signal, actionable feedback as short markdown bullets grouped by table. Skip praise — focus on what to change and why.',
      '',
      '```sql',
      sql,
      '```',
    ].join('\n');

    let child;
    try {
      // Neutral cwd: schema text flows into the prompt, so a poisoned migration comment
      // must not be able to steer the child into reading repo files from its cwd.
      child = spawn('claude', ['-p'], { env: childEnvAllowlist(), cwd: os.tmpdir() });
    } catch (e) {
      reviewInFlight = false;
      json(res, 200, { unavailable: true, error: String(e?.message || e) });
      return;
    }

    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, 180000);
    const done = (obj) => {
      reviewInFlight = false;
      clearTimeout(timer);
      if (!res.writableEnded) json(res, 200, obj);
    };

    child.on('error', (e) => {
      done(e && e.code === 'ENOENT' ? { unavailable: true } : { error: String(e.message || e) });
    });
    child.stdout.on('data', (d) => {
      out += d;
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('close', (code) => {
      if (code === 0 && out.trim()) done({ review: out.trim() });
      else done({ error: err.trim() || `claude exited with code ${code}` });
    });
    child.stdin.end(prompt);
  }

  /** Read the request body, then hand off to {@link runSchemaReview}. */
  function readReviewBody(req, res) {
    let body = '';
    let oversized = false;
    let phase = 'reading';

    req.on('data', (c) => {
      body += c;
      if (body.length > 1e6) {
        oversized = true;
        reviewInFlight = false;
        if (!res.headersSent) json(res, 413, { error: 'Body too large (max 1 MB)' });
        req.destroy();
      }
    });
    // 'close' (not the deprecated 'aborted') so a mid-body disconnect can never leave the
    // in-flight flag stuck; after a normal 'end' the phase is 'running', so this is a no-op.
    req.on('close', () => {
      if (phase === 'reading' && !oversized) reviewInFlight = false;
    });
    req.on('end', () => {
      if (oversized || res.writableEnded) return;
      let sql = '';
      try {
        sql = JSON.parse(body).sql || '';
      } catch {
        reviewInFlight = false;
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      phase = 'running';
      runSchemaReview(res, sql);
    });
  }

  /** POST /api/review — opt-in, one at a time, JSON only. */
  function handleReviewRequest(req, res) {
    if (!reviewEnabled) {
      return json(res, 403, {
        unavailable: true,
        error: 'Deep review disabled. Set DB_VIEWER_REVIEW=1 to enable (loopback only).',
      });
    }
    const ct = String(req.headers['content-type'] || '');
    if (!ct.includes('application/json')) {
      return json(res, 415, { error: 'Content-Type must be application/json' });
    }
    if (reviewInFlight) {
      return json(res, 429, { error: 'Review already in progress' });
    }
    // Claim the slot before body read so concurrent POSTs cannot both spawn.
    reviewInFlight = true;
    readReviewBody(req, res);
  }

  /** GET /api/diff — schema delta between two versions. */
  function handleDiffRequest(req, res, searchParams) {
    if (req.method !== 'GET') {
      return json(res, 405, { error: 'Method not allowed' });
    }
    const from = versions.find((v) => v.id === Number(searchParams.get('from')));
    const to = versions.find((v) => v.id === Number(searchParams.get('to')));
    if (!to) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    const diff = diffSchemas(from ? from.schema : { tables: [] }, to.schema);
    if (!diff.changelog?.length && to.kind === 'migration' && to.structural === false) {
      diff.note = 'No structural table/column changes (RLS / index / function)';
    }
    json(res, 200, { diff, from: from ? from.id : null, to: to.id });
  }

  /** GET /api/migration — the SQL file backing one version, if it has one. */
  function handleMigrationRequest(req, res, searchParams) {
    if (req.method !== 'GET') {
      return json(res, 405, { error: 'Method not allowed' });
    }
    const v = versions.find((x) => x.id === Number(searchParams.get('id')));
    if (!v) return json(res, 404, { error: 'Version not found' });

    if (v.kind === 'latest' || !v.file) {
      return json(res, 200, {
        id: v.id,
        kind: v.kind || 'save',
        reason: v.reason,
        at: v.at,
        file: null,
        content: null,
        note: v.kind === 'latest' ? 'Latest has no migration SQL file' : 'No migration file',
      });
    }
    if (!(migrationMode && migrationsDir)) {
      return json(res, 404, { error: 'Not in migration mode' });
    }

    const filePath = path.resolve(migrationsDir, path.basename(v.file));
    if (
      !filePath.startsWith(path.resolve(migrationsDir) + path.sep) &&
      filePath !== path.resolve(migrationsDir)
    ) {
      return json(res, 400, { error: 'Invalid migration path' });
    }
    let content = '';
    try {
      content = fs.readFileSync(filePath, 'utf8');
    } catch (e) {
      return json(res, 404, { error: String(e?.message || e) });
    }
    return json(res, 200, {
      id: v.id,
      kind: v.kind,
      reason: v.reason,
      at: v.at,
      file: v.file,
      content,
    });
  }

  /** Everything else: the static bundle under `public/`. */
  function serveStaticFile(res, pathname) {
    const file = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.join(publicDir, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    });
  }

  const server = http.createServer((req, res) => {
    let pathname;
    let searchParams;
    try {
      ({ pathname, searchParams } = parseRequestUrl(req));
    } catch {
      res.writeHead(400);
      res.end('Bad request');
      return;
    }

    if (rejectUntrustedRequest(req, res, pathname, searchParams)) return;

    if (pathname === '/events') return handleEventsStream(req, res);
    if (pathname === '/api/review' && req.method === 'POST') return handleReviewRequest(req, res);
    if (pathname === '/api/diff') return handleDiffRequest(req, res, searchParams);
    if (pathname === '/api/migration') return handleMigrationRequest(req, res, searchParams);

    serveStaticFile(res, pathname);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(
        `\n  DB Viewer: port ${port} is already in use.\n  Try: pnpm db:viewer -- --port ${port + 1}\n`,
      );
      process.exit(1);
    }
    console.error('DB Viewer server error:', err);
    process.exit(1);
  });

  server.listen(port, BIND_HOST, () => {
    if (migrationMode) {
      rebuildMigrationVersions();
    } else {
      loadHistory();
      snapshot(versions.length ? 'changed since last run' : 'initial');
    }
    watch();
    // The token stays in the URL (not stripped client-side) so reloads keep working.
    const url = `http://${BIND_HOST}:${port}/?token=${sessionToken}`;
    console.log(`\n  DB Viewer${projectName ? ` · ${projectName}` : ''} running`);
    console.log(`  → ${url} (loopback only, session token required)`);
    console.log(`  schema:     ${target}`);
    if (migrationMode) {
      console.log(`  migrations: ${migrationsDir} (${Math.max(0, versions.length - 1)} + Latest)`);
      if (skippedStatements)
        console.log(`  skipped:    ${skippedStatements} unhandled statement(s) during replay`);
    }
    if (reviewEnabled) console.log('  review:     enabled (DB_VIEWER_REVIEW=1)');
    console.log(
      `  history:    ${versions.length} version(s)${fresh ? ' (fresh)' : ''}${migrationMode ? ' [migration mode]' : ''}\n`,
    );
    if (shouldOpen) openUrl(url);
  });

  return server;
}

export { startServer };
