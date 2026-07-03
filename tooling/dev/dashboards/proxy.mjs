#!/usr/bin/env node
// Dashboards hub + authenticating reverse proxy (part of tooling/dev/dashboards/).
//
// Serves the single-page control-room hub at http://localhost:3010/ and proxies the gated
// dashboards so they open in any browser: a browser can't attach an `Authorization: Bearer`
// header to a plain navigation, so this proxy injects the metrics scrape token and a
// self-refreshing super_admin JWT and forwards to the API. It also serves /_status (live
// health + latency), /_worker/* (worker readiness/metrics), and the vendored Tailwind engine
// at /_hub/tw.js, and strips frame-blocking headers so dashboards can be embedded if wanted.
//
//   pnpm dashboards:proxy        (or: node tooling/dev/dashboards/proxy.mjs)
//     → http://localhost:3010/                the hub (status, queues, metrics, links)
//     → http://localhost:3010/admin/queues    Bull Board (super_admin JWT injected, refreshed)
//     → http://localhost:3010/metrics         Prometheus (METRICS_SCRAPE_TOKEN injected)
//     → http://localhost:3010/reference/      Scalar API docs (public)
//
// The hub UI is ./hub.html (read per request — edit it live, no restart).
// Env (optional): PROXY_PORT (3010), API_PORT (PORT from .env.local, else 3000),
//                 DEMO_EMAIL, DEMO_PASSWORD.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const HUB_HTML_PATH = join(ROOT, 'tooling/dev/dashboards/hub.html');
const TW_PATH = join(ROOT, 'tooling/dev/dashboards/tailwind.js');
const GRIDSTACK_JS_PATH = join(ROOT, 'tooling/dev/dashboards/gridstack.js');
const GRIDSTACK_CSS_PATH = join(ROOT, 'tooling/dev/dashboards/gridstack.css');

function envVal(key) {
  try {
    const line = readFileSync(join(ROOT, '.env.local'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  } catch {
    return '';
  }
}

const TARGET_HOST = '127.0.0.1';
const TARGET_PORT = Number(process.env.API_PORT || envVal('PORT') || 3000);
const PROXY_PORT = Number(process.env.PROXY_PORT || process.env.PORT || 3010);
const METRICS_TOKEN = envVal('METRICS_SCRAPE_TOKEN');
// The super_admin this proxy logs in as to mint the Bull Board JWT. `dashboards:up` ensures
// this user via `pnpm db:seed:demo-admin` — keep these defaults in sync with that script
// (src/scripts/seed/ensure-demo-admin.ts) so the seeded password matches what we submit here.
const DEMO_EMAIL = process.env.DEMO_EMAIL || 'demo@example.com';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'DemoPassword123!';
const WORKER_PORT = 9090;
const SONAR_PORT = 9000;
const STUDIO_PORT = 4983;

// Headers that would stop a dashboard from rendering inside the hub's <iframe>. Stripped on
// proxied responses — this is a localhost-only dev proxy, so relaxing them is intentional.
const FRAME_BLOCK_HEADERS = [
  'x-frame-options',
  'content-security-policy',
  'cross-origin-embedder-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
];

let adminToken = null;

function upstream(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 502,
          headers: res.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    req.on('error', reject);
    if (body?.length) req.write(body);
    req.end();
  });
}

async function login() {
  const res = await upstream(
    {
      host: TARGET_HOST,
      port: TARGET_PORT,
      method: 'POST',
      path: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json', 'x-captcha-bypass': 'true' },
    },
    Buffer.from(JSON.stringify({ email: DEMO_EMAIL, password: DEMO_PASSWORD })),
  );
  let token = null;
  try {
    const data = JSON.parse(res.body.toString());
    token = data?.data?.access_token ?? data?.access_token ?? null;
  } catch {
    /* fall through to error below */
  }
  if (!token) {
    throw new Error(`login failed (status ${res.status}): ${res.body.toString().slice(0, 200)}`);
  }
  adminToken = token;
  return token;
}

function isMetricsPath(path) {
  return path === '/metrics' || path.startsWith('/metrics?');
}

function isHubPath(path) {
  return path === '/' || path === '/dashboards' || path === '/dashboards/';
}

function stripFrameHeaders(headers) {
  const out = { ...headers };
  delete out['content-encoding'];
  delete out['content-length'];
  for (const key of FRAME_BLOCK_HEADERS) delete out[key];
  return out;
}

/** GET a localhost:port path; resolve { code, ms } (code 0 on error/timeout). */
function probe(port, path, bearer) {
  return new Promise((resolve) => {
    const start = process.hrtime.bigint();
    const elapsed = () => Math.round(Number(process.hrtime.bigint() - start) / 1e6);
    const req = http.request(
      {
        host: TARGET_HOST,
        port,
        path,
        method: 'GET',
        timeout: 2500,
        headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
      },
      (res) => {
        res.resume();
        resolve({ code: res.statusCode ?? 0, ms: elapsed() });
      },
    );
    req.on('error', () => resolve({ code: 0, ms: elapsed() }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ code: 0, ms: 2500 });
    });
    req.end();
  });
}

let statusCache = null;
let statusCacheAt = 0;

/**
 * Server-side health (+latency) of every dashboard target — no browser CORS limits.
 * Cached for 3s so several open hub tabs polling at once don't trip the API rate limiter.
 */
async function probeAll() {
  if (statusCache && Date.now() - statusCacheAt < 3000) return statusCache;
  let token = adminToken;
  if (!token) {
    try {
      token = await login();
    } catch {
      token = null;
    }
  }
  const [api, reference, bullboard, metrics, worker, sonar, drizzle] = await Promise.all([
    probe(TARGET_PORT, '/livez'),
    probe(TARGET_PORT, '/reference/'),
    probe(TARGET_PORT, '/admin/queues', token),
    probe(TARGET_PORT, '/metrics', METRICS_TOKEN),
    probe(WORKER_PORT, '/readyz'),
    probe(SONAR_PORT, '/api/system/status'),
    probe(STUDIO_PORT, '/'),
  ]);
  const ok = (c) => c >= 200 && c < 400;
  const entry = (p, anyResponse) => ({ up: anyResponse ? p.code > 0 : ok(p.code), ms: p.ms });
  statusCache = {
    api: entry(api),
    reference: entry(reference),
    bullboard: entry(bullboard),
    metrics: entry(metrics),
    worker: entry(worker),
    sonar: entry(sonar),
    drizzle: entry(drizzle, true),
  };
  statusCacheAt = Date.now();
  return statusCache;
}

function readHub() {
  try {
    return readFileSync(HUB_HTML_PATH, 'utf8');
  } catch {
    return '<!doctype html><meta charset="utf-8"><body style="font:14px system-ui;padding:40px">Hub file missing: tooling/dev/dashboards/hub.html</body>';
  }
}

function sendError(res, error) {
  res.writeHead(502, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ proxy_error: String(error?.message || error) }));
}

async function serveStatus(res) {
  const status = await probeAll();
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify(status));
}

async function serveWorker(res, path) {
  const workerPath = path.slice('/_worker'.length) || '/';
  const headers =
    workerPath.startsWith('/metrics') && METRICS_TOKEN
      ? { authorization: `Bearer ${METRICS_TOKEN}` }
      : {};
  const r = await upstream({
    host: TARGET_HOST,
    port: WORKER_PORT,
    method: 'GET',
    path: workerPath,
    headers,
  });
  res.writeHead(r.status, stripFrameHeaders(r.headers));
  res.end(r.body);
}

// Forward to the API with the right token injected, re-logging in once on a 401.
async function serveProxy(clientReq, res, path, reqBody) {
  const metrics = isMetricsPath(path);
  const forward = (bearer) => {
    const headers = { ...clientReq.headers, host: `${TARGET_HOST}:${TARGET_PORT}` };
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    delete headers['accept-encoding']; // keep upstream responses uncompressed for simple piping
    return upstream(
      { host: TARGET_HOST, port: TARGET_PORT, method: clientReq.method, path, headers },
      reqBody,
    );
  };
  const bearer = metrics ? METRICS_TOKEN : adminToken || (await login());
  let response = await forward(bearer);
  if (!metrics && response.status === 401) {
    await login();
    response = await forward(adminToken);
  }
  res.writeHead(response.status, stripFrameHeaders(response.headers));
  res.end(response.body);
}

async function handleRequest(clientReq, res, reqBody) {
  const path = clientReq.url || '/';
  if (clientReq.method === 'GET' && isHubPath(path)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(readHub());
    return;
  }
  if (clientReq.method === 'GET' && path === '/_hub/tw.js') {
    try {
      res.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      });
      res.end(readFileSync(TW_PATH));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(
        'tailwind asset missing — curl https://cdn.tailwindcss.com -o tooling/dev/dashboards/tailwind.js',
      );
    }
    return;
  }
  if (
    clientReq.method === 'GET' &&
    (path === '/_hub/gridstack.js' || path === '/_hub/gridstack.css')
  ) {
    const isCss = path.endsWith('.css');
    try {
      res.writeHead(200, {
        'content-type': isCss ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      });
      res.end(readFileSync(isCss ? GRIDSTACK_CSS_PATH : GRIDSTACK_JS_PATH));
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end(
        'gridstack asset missing — curl https://cdn.jsdelivr.net/npm/gridstack@11/dist/gridstack-all.min.js -o tooling/dev/dashboards/gridstack.js',
      );
    }
    return;
  }
  if (clientReq.method === 'GET' && path === '/_status') return serveStatus(res);
  if (clientReq.method === 'GET' && path.startsWith('/_worker/')) return serveWorker(res, path);
  return serveProxy(clientReq, res, path, reqBody);
}

const server = http.createServer((clientReq, clientRes) => {
  const chunks = [];
  clientReq.on('data', (c) => chunks.push(c));
  clientReq.on('end', () => {
    handleRequest(clientReq, clientRes, Buffer.concat(chunks)).catch((error) =>
      sendError(clientRes, error),
    );
  });
});

server.listen(PROXY_PORT, '127.0.0.1', () => {
  const base = `http://localhost:${PROXY_PORT}`;
  process.stdout.write(
    `\n  Dashboards hub → ${base}/   (tabbed control room · live status)\n` +
      `  Auth proxy     → ${base}    (→ API http://${TARGET_HOST}:${TARGET_PORT})\n\n` +
      (METRICS_TOKEN ? '' : '  ! METRICS_SCRAPE_TOKEN is empty — /metrics may already be open.\n'),
  );
});
