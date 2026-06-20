#!/usr/bin/env node
// MCP server exposing the local core-be dashboards data as read-only tools, so an agent
// (Claude Code / Cursor / Codex) can check the running stack without curl. It reads from the
// dashboards auth proxy on :3010 — run `pnpm dashboards:up` (or `pnpm dashboards:proxy`) first.
//
// Wired in .mcp.example.json as the on-demand `dashboards` server:
//   "dashboards": { "type": "stdio", "command": "node", "args": ["tooling/dev/dashboards-mcp.mjs"] }
//
// Env (optional): DASHBOARDS_PROXY_URL (default http://127.0.0.1:3010).

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const BASE = (process.env.DASHBOARDS_PROXY_URL || 'http://127.0.0.1:3010').replace(/\/$/, '');
const EMPTY = { type: 'object', properties: {}, additionalProperties: false };

async function get(path) {
  const res = await fetch(BASE + path, { signal: AbortSignal.timeout(5000) });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
const unwrap = (j) => (j && typeof j === 'object' && j.meta && j.data !== undefined ? j.data : j);

const TOOLS = [
  {
    name: 'local_stack_status',
    description:
      'Live up/down state and latency (ms) for every local core-be dashboard service: API, worker, queues (Bull Board), metrics, SonarQube, Drizzle Studio. Use this to check if the local stack is healthy.',
    inputSchema: EMPTY,
    run: async () => {
      const s = await get('/_status');
      const lines = Object.entries(s).map(
        ([k, v]) => `${v.up ? 'UP  ' : 'DOWN'} ${k.padEnd(12)} ${v.ms}ms`,
      );
      const up = Object.values(s).filter((v) => v.up).length;
      return `${up}/${Object.keys(s).length} services online\n${lines.join('\n')}`;
    },
  },
  {
    name: 'local_worker_health',
    description:
      'BullMQ worker readiness: status, workers registered, and Database/Redis/BullMQ connectivity with latency. Use to verify the worker process is healthy.',
    inputSchema: EMPTY,
    run: async () => {
      const d = unwrap(await get('/_worker/readyz'));
      const deps = ['database', 'redis', 'bullmq'].map(
        (k) => `  ${k}: ${d[k]} (${d.latencyMs?.[k]}ms)`,
      );
      return `status: ${d.status}\nworkers registered: ${d.workersRegistered}\ndependencies:\n${deps.join('\n')}\nqueues registered: ${(d.worker_queues || []).length}`;
    },
  },
  {
    name: 'local_queue_stats',
    description:
      'Per-queue BullMQ stats from Bull Board: totals (waiting/active/delayed/failed/paused), dead-letter depth, and a breakdown of queues that have jobs. Use to inspect queue backlogs, failures, or DLQs.',
    inputSchema: EMPTY,
    run: async () => {
      const j = unwrap(await get('/admin/queues/api/queues?page=1'));
      const queues = j.queues || [];
      const K = ['waiting', 'active', 'delayed', 'failed', 'paused', 'completed'];
      const agg = Object.fromEntries(K.map((k) => [k, 0]));
      let dlq = 0;
      for (const q of queues) {
        const c = q.counts || {};
        for (const k of K) agg[k] += c[k] || 0;
        if (/-dlq$/.test(q.name))
          dlq += (c.waiting || 0) + (c.failed || 0) + (c.delayed || 0) + (c.active || 0);
      }
      const active = queues
        .filter((q) => K.filter((k) => k !== 'completed').some((k) => q.counts?.[k] > 0))
        .map(
          (q) =>
            `  ${q.name}: ` +
            K.filter((k) => q.counts[k])
              .map((k) => `${q.counts[k]} ${k}`)
              .join(', '),
        );
      return (
        `totals — waiting ${agg.waiting} · active ${agg.active} · delayed ${agg.delayed} · failed ${agg.failed} · paused ${agg.paused} · dlq-depth ${dlq}\n` +
        `${queues.length} queues (${active.length} with jobs):\n${active.join('\n') || '  (all idle)'}`
      );
    },
  },
  {
    name: 'local_metrics',
    description:
      'Key parsed Prometheus metrics from the API: HTTP requests, memory (RSS), event-loop p99 lag, CPU time, queue waiting/failed, mail outbox, DLQ depth. Use for a quick runtime snapshot.',
    inputSchema: EMPTY,
    run: async () => {
      const text = await get('/metrics');
      const sums = {};
      for (const line of String(text).split('\n')) {
        if (!line || line[0] === '#') continue;
        const m = line.match(/^([a-zA-Z_:][\w:]*)(\{[^}]*\})?\s+(-?[\d.eE+]+)/);
        if (!m) continue;
        const v = parseFloat(m[3]);
        sums[m[1]] = (sums[m[1]] || 0) + (Number.isFinite(v) ? v : 0);
      }
      const pick = [
        ['http_requests_total', 'HTTP requests', (v) => Math.round(v).toLocaleString()],
        ['process_resident_memory_bytes', 'Memory RSS', (v) => `${(v / 1048576).toFixed(0)} MB`],
        [
          'nodejs_eventloop_lag_p99_seconds',
          'Event-loop p99',
          (v) => `${(v * 1000).toFixed(1)} ms`,
        ],
        ['process_cpu_seconds_total', 'CPU time', (v) => `${v.toFixed(1)} s`],
        ['bullmq_queue_waiting', 'Queue waiting', (v) => String(Math.round(v))],
        ['bullmq_queue_failed', 'Queue failed', (v) => String(Math.round(v))],
        ['mail_outbox_pending', 'Mail outbox', (v) => String(Math.round(v))],
        ['dlq_depth', 'DLQ depth', (v) => String(Math.round(v))],
      ];
      return pick
        .map(([n, label, f]) => `  ${label}: ${sums[n] === undefined ? 'n/a' : f(sums[n])}`)
        .join('\n');
    },
  },
];

const server = new Server(
  { name: 'core-be-dashboards', version: '1.0.0' },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool)
    return {
      content: [{ type: 'text', text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  try {
    return { content: [{ type: 'text', text: await tool.run() }] };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Could not reach the dashboards proxy at ${BASE} (${error?.message || error}). Start it with: pnpm dashboards:up`,
        },
      ],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
