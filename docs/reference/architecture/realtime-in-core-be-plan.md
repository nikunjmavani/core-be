# Realtime in `core-be` — the socket as a third service

> **This is the chosen architecture.** WebSockets run as a **third `core-be` service** —
> `api`, `worker`, `socket` — sharing one repository, one language, one CI, one set of conventions,
> but running as **separate processes** with independent deploys and independent scaling.
>
> **Status:** proposal. Nothing here is implemented yet.
> **Siblings:** [`realtime-go-service-plan.md`](realtime-go-service-plan.md) (the standalone-Go
> alternative; its Appendix C is the trade-off analysis) ·
> [`realtime-implementation-map.md`](realtime-implementation-map.md) (the `core-be` file map).

---

## 1 · Why a third service is the right call

Running the socket as its own service rather than inside `api` **removes both of the costs** that
Appendix C identified as decisive, while keeping every advantage of staying in `core-be`.

An earlier draft of this plan put the socket inside the `api` process. That was worse, and the
correction matters enough to state plainly:

| Concern | Socket **inside `api`** | Socket as a **third service** |
|---|---|---|
| Event-loop contention with API handlers | 🔴 A 10 k-socket broadcast blocks the API for ~30–100 ms | ✅ **Gone.** Separate process, separate event loop |
| Every API deploy drops every socket | 🔴 ~200 k reconnect requests/day at 10 k users × 5 deploys | ✅ **Gone.** Deploys are independent |
| Scaling | 🔴 One dial for two unrelated workloads | ✅ Scale by connections; `api` scales by request rate |
| Blast radius of a socket bug | 🔴 Takes down the API | ✅ Contained to the socket service |
| New language / repo / CI | ✅ none | ✅ **none** — same repo, same TypeScript |
| Internal HTTP API needed | ✅ none | ✅ **none** — it imports the same services directly |
| Postgres connection budget | ✅ unchanged | 🟠 A third pool to account for (§7.3) |

**The key insight:** a separate *process* is what fixes the two red rows — not a separate
*language* or a separate *repository*. Because the socket service runs the same TypeScript, it
imports `AuthSessionService`, `MembershipService` and `AuthorizationService` **directly**, exactly as
the `worker` service already does. There is no internal handshake endpoint, no shared secret, and no
cross-language contract to keep in sync.

This is the same shape the repo already uses. `worker` is not a different repo or a different
language — it is `src/worker.ts`, its own Docker target, its own Railway service, importing domain
code and owning its own connections. `socket` follows that pattern exactly.

### 1.1 · Service topology

```mermaid
flowchart TB
  FE["core-fe · browser"]

  subgraph REPO["core-be — ONE repository, ONE language, ONE CI"]
    direction LR
    API["<b>api</b><br/>src/server.ts<br/>REST · auth · RLS<br/><i>scales by request rate</i>"]
    SOCK["<b>socket</b> 🆕<br/>src/socket.ts<br/>WS · registry · tiering<br/><i>scales by connections</i>"]
    WORK["<b>worker</b><br/>src/worker.ts<br/>BullMQ jobs<br/><i>scales by queue depth</i>"]
  end

  PG[("Postgres")]
  RD[("Redis")]

  FE ===|"1 · REST — all reads/writes"| API
  FE <-->|"5 · WebSocket frames"| SOCK

  API ==>|"2 · commit"| PG
  API -->|"3 · XADD after commit"| RD
  RD -->|"4 · XREAD"| SOCK
  SOCK -.->|"session + membership<br/>(cache-first, small pool)"| PG
  WORK --- RD
  WORK --- PG

  style SOCK fill:#7aa2ff,color:#0f1117,stroke:none
  style API fill:#4cc38a,color:#0f1117,stroke:none
  style WORK fill:#c792ea,color:#0f1117,stroke:none
```

Three processes, one codebase. `socket` shares every type, service, constant and lint rule with
`api` — it just runs somewhere else.

### 1.2 · Scalability — what each dial does

| Service | Scale when | Typical shape | Notes |
|---|---|---|---|
| `api` | Request rate / p99 latency climbs | 2–N replicas, CPU-bound | Unchanged by this feature |
| `socket` | **Concurrent connections** climb | 2–N replicas, **memory-bound** | ~40–150 KB/conn; budget ~5–10 k conns per 512 MB replica and **measure** |
| `worker` | Queue depth / job lag | 1–N replicas | Unchanged |

**Socket replicas are interchangeable.** Every replica reads the same Redis stream and filters
against its own registry, so:

- **No sticky sessions.** Any client can land on any replica.
- **No cross-replica routing table.** A replica that does not hold the target simply drops the event.
- **Adding a replica is free** — it starts reading the stream and accepting connections.

This is what makes horizontal scaling boring, and it is worth protecting: the moment any code needs
to know *which* replica holds a user, that property is gone.

---

## 2 · Installation — from nothing to a running socket service

Everything below is inside the existing `core-be` repo. **No new tooling, no new language.**

### Step 1 · One dependency

```sh
pnpm add @fastify/websocket
```

That is the entire dependency footprint. Fastify, Redis, Postgres, Zod, Pino, Sentry and OTel are
already in the tree and are reused as-is.

> Remember the lockfile rule from `CLAUDE.md`: a `package.json` change and its `pnpm-lock.yaml`
> regeneration are **one atomic commit**. Run `pnpm install` and stage both, or every frozen-install
> CI job fails with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.

### Step 2 · The entrypoint

`src/socket.ts`, modelled on `src/worker.ts`:

```ts
import '@/shared/config/load-env-files.js';
import { initSentry, captureException, flushSentry } from '@/infrastructure/observability/sentry/sentry.js';
import { initOpenTelemetry, shutdownOpenTelemetry } from '@/infrastructure/observability/tracing/otel.js';
import { OTEL_SERVICE_NAME_SOCKET } from '@/shared/constants/project-identity.constants.js';
import { connectRedis, closeRedis } from '@/infrastructure/cache/redis.client.js';
import { closeDatabase } from '@/infrastructure/database/connection.js';
import { assertPostgresConnectionBudget } from '@/infrastructure/database/safety/assert-connection-budget.js';
import { assertRedisTlsVerification } from '@/infrastructure/cache/assert-redis-tls-safety.js';
import { logger } from '@/shared/utils/infrastructure/logger.util.js';
import { buildSocketApp } from '@/socket-app.js';
import { startRealtimeIngest, stopRealtimeIngest } from '@/infrastructure/realtime/realtime-ingest.js';
import { closeAllSockets } from '@/infrastructure/realtime/realtime-registry.js';

initSentry();
initOpenTelemetry(OTEL_SERVICE_NAME_SOCKET);

const application = await buildSocketApp();

await assertRedisTlsVerification();
await assertPostgresConnectionBudget();          // ← must know about the socket service (§7.3)
await connectRedis();
startRealtimeIngest();                            // XREAD loop

await application.listen({ port: env.SOCKET_PORT, host: env.HTTP_BIND_HOST });
logger.info({ port: env.SOCKET_PORT }, 'realtime.socket.listening');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'realtime.socket.shutdown.start');
  application.server.close();                     // stop accepting new upgrades
  stopRealtimeIngest();
  await closeAllSockets();                        // 1001 + PER-CONNECTION jitter (§6.4)
  await application.close();
  await Promise.allSettled([closeRedis(), closeDatabase()]);
  await flushSentry();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
```

`src/socket-app.ts` builds a **minimal** Fastify instance: `@fastify/websocket`, `@fastify/cookie`,
the health routes, and the socket route. It deliberately does **not** register the REST middleware
stack (rate limits, idempotency, i18n, compression) — none of it applies to a single upgrade route,
and leaving it out keeps the process lean.

### Step 3 · Scripts

```jsonc
// package.json
"dev:socket":   "tsx watch src/socket.ts",
"start:socket": "node dist/src/socket.js",
```

`pnpm build` already compiles everything under `src/`, so no build change is needed.

### Step 4 · Docker target

`Dockerfile` already has a shared `runtime` stage with `AS worker` and `AS api` on top. Add a third:

```dockerfile
FROM runtime AS socket
ENV NODE_ENV=production
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SOCKET_PORT||'8080')+'/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/socket.js"]
```

### Step 5 · Local stack

```yaml
# docker-compose.yml — alongside the existing api-smoke service
socket:
  profiles: ['smoke']
  build: { context: ., dockerfile: Dockerfile, target: socket }
  ports: ['8080:8080']
  depends_on:
    redis: { condition: service_healthy }
    postgres: { condition: service_healthy }
  environment:
    NODE_ENV: development
    REALTIME_ENABLED: 'true'
    DATABASE_POOL_MAX: '5'          # small — cache-miss lookups only
```

Day-to-day you do not need Docker: `pnpm compose:up` then three terminals —
`pnpm dev`, `pnpm dev:worker`, `pnpm dev:socket`.

### Step 6 · Environment

Added to `env-schema.ts` with static production-safe defaults, then `pnpm tool:sync-env-example --fix`:

| Variable | Default | Purpose |
|---|---|---|
| `REALTIME_ENABLED` | `false` | Kill switch — gates the route **and** publishing |
| `SOCKET_PORT` | `8080` | Socket service HTTP port |
| `REALTIME_PUBLIC_URL` | *(none)* | `wss://…` returned to clients in the ticket response |
| `REALTIME_TICKET_TTL_SECONDS` | `30` | Connect-ticket lifetime |
| `REALTIME_MAX_SOCKETS_PER_USER` | `10` | Tab cap |
| `REALTIME_CROSS_ORG_TITLES` | `false` | Never leak another tenant's free text |
| `DEPLOYMENT_SOCKET_REPLICA_COUNT` | *(none)* | Feeds the connection-budget guard (§7.3) |

### Step 7 · Railway

A third service from the same image, `RAILWAY_SOCKET_SERVICE_ID` as a secret, and
`reusable-railway-deploy.yml` line ~351 changes from `for service_name in api worker` to
`for service_name in api worker socket`.

**Total install: one dependency, one entrypoint, two scripts, one Docker target.**

---

## 3 · How the socket is set up

### 3.1 · Authentication — the ticket, and why it comes back

The earlier in-`api` draft used the session cookie, because the upgrade was same-origin. **A third
service usually is not same-origin** (`wss://rt.example.com` vs `https://api.example.com`), and
browsers will not send the cookie cross-origin without widening its `Domain` scope. So:

| Topology | Auth on upgrade |
|---|---|
| Socket behind the **same public origin** (one ingress routing `/realtime/socket` to the socket service) | Cookie works; no ticket needed |
| Socket on its **own hostname** (Railway default) | **Ticket** — recommended, works everywhere |

**Recommended: the ticket.** It is topology-independent and avoids widening the session cookie to a
parent domain.

But note what it costs *here* versus the Go design: the `api` service mints the ticket into Redis,
and the socket service **redeems it from Redis directly** — same codebase, same services, no internal
HTTP endpoint and no shared secret. The Go plan needed `POST /internal/realtime/handshake` purely
because Go could not import TypeScript services. That whole endpoint disappears.

```mermaid
flowchart LR
  A["core-fe"] -->|"1 · POST /realtime/ticket<br/>(Bearer)"| B["api service"]
  B -->|"2 · SETEX rt:ticket:&lt;t&gt; 30s"| R[("Redis")]
  B -->|"3 · 201 { ticket, socket_url }"| A
  A -->|"4 · GET /v1/socket?ticket=…<br/>+ Origin"| C["socket service"]
  C -->|"5 · GETDEL — single use"| R
  C -->|"6 · memberships + permissions<br/>(imported services, cache-first)"| P[("Postgres")]
  C -->|"7 · 101 + connection.ready"| A
  style C fill:#7aa2ff,color:#0f1117,stroke:none
```

**The `Origin` check is mandatory and is not optional plumbing.** WebSocket upgrades are **not**
covered by CORS — browsers send them cross-origin with no preflight. Reuse
`requireAllowedSourceOriginForCookieSessionRoute` from
`src/shared/middlewares/session/cookie-session-origin.pre-handler.ts`; it takes a plain
`FastifyRequest` and already guards the refresh route.

### 3.2 · The route

```ts
// src/domains/realtime/realtime.routes.ts
application.get('/socket', {
  websocket: true,
  onRequest: [assertAllowedOrigin],          // ← CSWSH defence, before anything else
  schema: {
    summary: 'Open the realtime WebSocket stream',
    description:
      'Upgrades to a WebSocket after redeeming a single-use connect ticket. The socket is ' +
      'registered under every active membership; the requested organization becomes the active one.',
    tags: ['Realtime'],
    querystring: z.object({
      ticket: z.string().min(1),
      organization_id: z.string().min(1).optional(),
    }),
  },
}, controller.openSocket);
```

### 3.3 · The registry

```ts
interface SocketEntry {
  socketId: string;
  userId: string;                       // usr_…
  socket: WebSocket;
  memberships: Map<string, { role: string; permissions: Set<string> }>;   // orgId → …
  activeOrganizationId: string;
  sessionId: string;                    // so logout can close it directly
  isAlive: boolean;
  needsResync: boolean;
}

const byUser = new Map<string, Set<SocketEntry>>();   // usr_… → sockets
const byOrg  = new Map<string, Set<SocketEntry>>();   // org_… → sockets (EVERY membership)
```

A socket appears in `byOrg` for **every** membership, not just the active one. That is the
structural half of "delivery follows membership, presentation follows the active org".

### 3.4 · Heartbeat

Ping every 25 s; two consecutive misses terminate and deregister. Keep it **below** your proxy's
idle timeout (Cloudflare's is 100 s) — an idle timeout shorter than the heartbeat produces the
mystifying "disconnects exactly every N seconds" bug.

---

## 4 · Flow 1 — Login to live connection, with payloads

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FE as core-fe
  participant API as api service
  participant PG as Postgres
  participant RD as Redis
  participant SK as socket service

  rect rgba(122,162,255,0.08)
    Note over U,PG: PHASE 1 — AUTH (no sockets involved)
    U->>FE: email + password
    FE->>API: POST /api/v1/auth/login
    API->>PG: verify credentials, create session
    API-->>FE: 201 { access_token } + session_id cookie
  end

  rect rgba(199,146,234,0.09)
    Note over FE,API: PHASE 2 — FIRST PAINT (REST)
    FE->>API: GET /api/v1/notify/notifications
    API-->>FE: 200 list → TanStack Query
    Note over FE: UI fully usable. Everything below is enhancement.
  end

  rect rgba(76,195,138,0.09)
    Note over FE,SK: PHASE 3 — OPEN THE PIPE
    FE->>API: POST /api/v1/realtime/ticket (Bearer)
    API->>RD: SETEX rt:ticket:<t> 30s
    API-->>FE: 201 { ticket, socket_url, expires_in }
    FE->>SK: GET /v1/socket?ticket=…&organization_id=org_acme + Origin
    SK->>SK: assertAllowedOrigin(request)
    SK->>RD: GETDEL rt:ticket:<t> — single use
    SK->>PG: memberships + permissions (Redis-cached)
    SK-->>FE: 101 Switching Protocols
    SK-->>FE: frame connection.ready
  end
```

### 4.1 · `POST /api/v1/auth/login`

**Request**

```http
POST /api/v1/auth/login HTTP/1.1
Content-Type: application/json
Origin: https://app.example.com
```

```json
{ "email": "dakshil@acme.com", "password": "••••••••" }
```

**Response — `201 Created`**

```http
Set-Cookie: session_id=8f3a…; HttpOnly; Secure; SameSite=Lax; Path=/
```

```json
{
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1c3JfMmI4ZjRkNmExYzNlNWc3aDkiLCJvcmciOiJvcmdfN2hrM24ycDlxdzRyOHQ2eTF1NWkwIiwicm9sZSI6bnVsbCwiaWF0IjoxNzcw…"
  },
  "meta": { "request_id": "req_01J8ZQ9V3K2M7B4X6R0T8N5C1D" }
}
```

Decoded JWT claims — the socket service reads none of these directly, but they explain the model:

```json
{
  "sub": "usr_2b8f4d6a1c3e5g7h9",
  "org": "org_7hk3n2p9qw4r8t6y1u5i0",
  "iss": "core-be", "aud": "core-fe",
  "iat": 1770000000, "exp": 1770000900,
  "jti": "b6f1…"
}
```

### 4.2 · `POST /api/v1/realtime/ticket`

**Request**

```http
POST /api/v1/realtime/ticket HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIs…
Origin: https://app.example.com
```

No body. **Idempotency header is not required** — it mints a throwaway credential, not business
state.

**Response — `201 Created`**

```json
{
  "data": {
    "ticket": "rtk_9f2c7a1e4b8d3061af52c9e7",
    "socket_url": "wss://rt.example.com/v1/socket",
    "expires_in": 30
  },
  "meta": { "request_id": "req_01J8ZQA1M4P7…" }
}
```

What lands in Redis (key already carries the `core:<NODE_ENV>:` prefix):

```text
SETEX core:production:rt:ticket:rtk_9f2c7a1e4b8d3061af52c9e7 30
  {"user_id":"usr_2b8f4d6a1c3e5g7h9",
   "session_id":"ses_5k2m8p6q1w3e5r7t9",
   "organization_id":"org_7hk3n2p9qw4r8t6y1u5i0"}
```

**Failure modes**

| Status | When | Body `code` |
|---|---|---|
| `401` | Missing/expired bearer, or the session was revoked | `unauthorized` |
| `403` | `Origin` not in `ALLOWED_ORIGINS` | `origin_not_allowed` |
| `429` | Ticket-mint rate limit exceeded | `rate_limit_exceeded` |
| `503` | `REALTIME_ENABLED=false` | `service_unavailable` |

### 4.3 · The upgrade

**Request**

```http
GET /v1/socket?ticket=rtk_9f2c7a1e4b8d3061af52c9e7&organization_id=org_7hk3n2p9qw4r8t6y1u5i0 HTTP/1.1
Host: rt.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://app.example.com
```

**Response — `101 Switching Protocols`**

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

**First frame — server → client**

```json
{
  "v": 1,
  "type": "connection.ready",
  "id": "01J8ZQB4T7X2N9…",
  "occurred_at": "2026-08-12T09:14:22.481Z",
  "data": {
    "user_id": "usr_2b8f4d6a1c3e5g7h9",
    "active_organization_id": "org_7hk3n2p9qw4r8t6y1u5i0",
    "heartbeat_interval_ms": 25000,
    "memberships": [
      { "organization_id": "org_7hk3n2p9qw4r8t6y1u5i0", "role": "admin",  "unread_count": 0 },
      { "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m", "role": "member", "unread_count": 2 }
    ]
  }
}
```

That single frame is what paints the org switcher with `Acme ✓ · Globex (2)` on connect — including
notifications that arrived while the user was completely offline, because the counts come from
Postgres, not from the live stream.

**Failure modes on upgrade** — the connection closes instead of returning an HTTP status, because
the upgrade has already begun:

| Close code | When | Client should |
|---|---|---|
| `4401` | Ticket missing, expired, or already redeemed | Mint a fresh ticket, reconnect |
| `4403` | Not a member of `organization_id`; org suspended; no memberships | Not reconnect; let route guards handle it |
| `4408` | No valid ticket within 5 s | Reconnect with a fresh ticket |
| `4429` | `REALTIME_MAX_SOCKETS_PER_USER` exceeded | Back off ≥ 60 s (too many tabs) |
| *(403 before upgrade)* | `Origin` rejected — this one **is** an HTTP response | Never happens for a legitimate client |

---

## 5 · Flow 2 — A data update, with payloads

```mermaid
sequenceDiagram
  autonumber
  actor TM as Teammate
  participant API as api service
  participant PG as Postgres
  participant CD as commit-dispatch
  participant RD as Redis Streams
  participant SK as socket service
  participant FE as core-fe (you)

  TM->>API: POST /api/v1/tasks/7/assign
  API->>PG: BEGIN · UPDATE task · INSERT notification
  PG-->>API: COMMIT ✔ truth persisted FIRST
  API->>CD: scheduleCommitDispatch { realtime_event, envelope }
  CD->>RD: task persisted BEFORE the response returns
  API-->>TM: 201 Created
  CD->>RD: XADD rt:events
  RD-->>SK: XREAD (all socket replicas)
  SK->>SK: registry lookup + tierFor() → TierFull
  SK-->>FE: ONE frame
  FE->>FE: dedupe · badge +1 · invalidateQueries
  FE->>API: GET /api/v1/notify/notifications
  API-->>FE: 200 authoritative list — the server WINS
  opt user opens it
    FE->>API: PATCH /notify/notifications/{id}/read
    Note over FE,API: REST, never a socket frame
  end
```

### 5.1 · The teammate's write

**Request**

```http
POST /api/v1/tasks/7/assign HTTP/1.1
Authorization: Bearer <teammate token>
X-Idempotency-Key: 4f2c-…
```

```json
{ "assignee_id": "usr_2b8f4d6a1c3e5g7h9" }
```

**Response — `201 Created`.** The teammate's request is finished here; it knows nothing about
sockets.

### 5.2 · What lands in the stream

```text
XADD core:production:rt:events MAXLEN ~ 10000 *
  v 1
  payload '{…the envelope below…}'
```

```json
{
  "v": 1,
  "id": "01J8ZQC9V3K2M7B4X6R0T8N5C1",
  "type": "notification.created",
  "occurred_at": "2026-08-12T09:31:04.117Z",
  "organization_id": "org_7hk3n2p9qw4r8t6y1u5i0",
  "scope": "user",
  "target_user_id": "usr_2b8f4d6a1c3e5g7h9",
  "summary": {
    "resource_id": "ntf_4k2m8p6q1w3e5r7t9",
    "unread_count_delta": 1
  },
  "payload": {
    "type": "TASK_ASSIGNED",
    "title": "Task 7 assigned to you",
    "action_url": "/organization/acme/tasks/7"
  }
}
```

- `id` is a **ULID** — the client's dedupe key, and k-sortable.
- `summary` is the always-safe projection. `payload` is the privileged one.
- No row contents, no PII beyond a title, nothing large. The stream is an *announcement* channel.

### 5.3 · The frame the browser receives

Because Acme **is** the active org, `tierFor()` returns `Full` and the frame carries both
projections:

```json
{
  "v": 1,
  "id": "01J8ZQC9V3K2M7B4X6R0T8N5C1",
  "type": "notification.created",
  "occurred_at": "2026-08-12T09:31:04.117Z",
  "organization_id": "org_7hk3n2p9qw4r8t6y1u5i0",
  "summary": { "resource_id": "ntf_4k2m8p6q1w3e5r7t9", "unread_count_delta": 1 },
  "payload": {
    "type": "TASK_ASSIGNED",
    "title": "Task 7 assigned to you",
    "action_url": "/organization/acme/tasks/7"
  }
}
```

`target_user_id` and `scope` are **stripped before sending** — routing metadata is the server's
business, and echoing another user's id back to a client is a needless disclosure.

### 5.4 · What the client does with it

```ts
if (seen.has(env.id)) return;                     // dedupe — at-least-once is expected
queryClient.setQueryData(unreadCount(env.organization_id), n => n + env.summary.unread_count_delta);
queryClient.invalidateQueries({ queryKey: list(env.organization_id) });
if (env.payload) notify.info(env.payload.title);
```

### 5.5 · The refetch — where the data actually arrives

**Request**

```http
GET /api/v1/notify/notifications?limit=20 HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIs…
```

**Response — `200 OK`** (shape from `notification.serializer.ts`)

```json
{
  "data": [
    {
      "id": "ntf_4k2m8p6q1w3e5r7t9",
      "type": "TASK_ASSIGNED",
      "title": "Task 7 assigned to you",
      "message": "Priya assigned you task #7 — Q3 rollout checklist.",
      "data": { "task_id": "tsk_8n3k5m2p9q1w4r7t6", "assigned_by": "usr_7t6y1u5i0p3n2k9wq" },
      "action_url": "/organization/acme/tasks/7",
      "action_label": "View task",
      "is_read": false,
      "read_at": null,
      "created_at": "2026-08-12T09:31:04.117Z"
    }
  ],
  "meta": {
    "request_id": "req_01J8ZQD2N5…",
    "pagination": { "per_page": 20, "next": null, "has_more": false }
  }
}
```

> **This is the point of the whole design.** The socket frame carried ~200 bytes of "something
> changed". The *data* came over REST, through auth, RLS, serialization and pagination — one code
> path, already tested. That is why a dropped, duplicated or reordered frame costs at most one extra
> refetch.

### 5.6 · Mark as read — REST, never a frame

```http
PATCH /api/v1/notify/notifications/ntf_4k2m8p6q1w3e5r7t9/read HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIs…
```

```json
{
  "data": { "id": "ntf_4k2m8p6q1w3e5r7t9", "is_read": true, "read_at": "2026-08-12T09:33:10.004Z" },
  "meta": { "request_id": "req_01J8ZQE7P…" }
}
```

A socket frame doing this write would bypass validation, idempotency, rate limits, the audit trail
and the RLS context wrapper — and would force the socket service to hold a write-capable DB
connection.

---

## 6 · Flow 3 — Multi-organization, with payloads

Dakshil is admin in **Acme** (active) and member in **Globex** (inactive). He is not a member of
**Initech**.

```mermaid
sequenceDiagram
  autonumber
  actor CG as Colleague in Globex
  participant API as api service
  participant RD as Redis
  participant SK as socket service
  participant FE as core-fe
  actor U as Dakshil (in Acme)

  Note over SK: One socket, registered under BOTH memberships.<br/>acme = ACTIVE · globex = inactive · initech = NO ENTRY

  rect rgba(199,146,234,0.10)
    CG->>API: POST /api/v1/docs/9/mention → usr_42
    API->>RD: commit, then XADD (organization_id = globex)
    RD-->>SK: XREAD
    SK->>SK: member of globex ✓ but NOT active → TierSummary
    SK-->>FE: frame WITHOUT payload
    Note over SK,FE: payload omitted at SERIALISATION.<br/>Another tenant's title never reaches the wire.
    FE-->>U: quiet dot — Globex (3)
  end

  rect rgba(229,165,75,0.10)
    U->>FE: click "Globex (3)"
    FE->>API: POST /api/v1/auth/switch-to-organization
    API-->>FE: 201 new access_token (org = globex)
    FE->>SK: frame active_org.set
    SK->>SK: re-verify membership, flip the flag
    SK-->>FE: frame active_org.changed
    FE->>API: GET /notify/notifications (globex token)
    Note over FE,SK: SAME socket. No reconnect. Roles reversed.
  end
```

### 6.1 · The inactive-org frame — note what is missing

```json
{
  "v": 1,
  "id": "01J8ZQF5R8T3Y6U1I0P9O7L2K4",
  "type": "notification.created",
  "occurred_at": "2026-08-12T10:02:47.900Z",
  "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m",
  "summary": { "resource_id": "ntf_1w3e5r7t9y2u4i6o8", "unread_count_delta": 1 }
}
```

**No `payload` key at all** — not `null`, *absent*. The title ("Priya mentioned you in Q3 layoffs —
draft") is another tenant's user-authored content and never leaves the socket service. The UI renders
"New activity in Globex" from `organization_id` alone.

This is enforced by `tierFor()` returning `Summary`, which marshals a **different object**. A
frontend bug cannot leak those fields because they never arrive. The test asserting
`frame.payload === undefined` for an inactive-org event is non-negotiable.

### 6.2 · The switch

**Request**

```http
POST /api/v1/auth/switch-to-organization HTTP/1.1
Authorization: Bearer <acme-scoped token>
```

```json
{ "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m" }
```

**Response — `201 Created`**

```json
{
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs…<org claim = globex>…",
    "active_organization": {
      "id": "org_9wq4r8t6y1u5i0p3n2k7m",
      "name": "Globex",
      "slug": "globex"
    },
    "my_permissions": ["notification.read", "document.read"],
    "global_role": null
  },
  "meta": { "request_id": "req_01J8ZQG1K…" }
}
```

Note the role change: admin in Acme, **member** in Globex, with a correspondingly smaller permission
set. The new token carries `org = globex`, and it — not the socket frame — is what authorizes the
REST reads that follow.

### 6.3 · Telling the socket — client → server

```json
{ "type": "active_org.set", "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m" }
```

**Server → client**

```json
{
  "v": 1,
  "type": "active_org.changed",
  "id": "01J8ZQH3M6…",
  "data": { "active_organization_id": "org_9wq4r8t6y1u5i0p3n2k7m" }
}
```

Rejected with close `4403` if the org is not in the socket's membership set. `active_org.set` is a
**presentation hint**, never an authorization decision — authorization was settled at connect.

### 6.4 · The complete client → server frame set

Four frames. Control only, forever if possible.

| Frame | Body | Effect |
|---|---|---|
| `active_org.set` | `{ organization_id }` | Flips the active membership. No reconnect |
| `resync.ack` | `{}` | Clears the server-side resync flag after the client refetched |
| `ping` | `{}` | Optional app-level liveness; protocol ping/pong is primary |
| *(none for auth)* | — | The connection's lifetime is the session's; logout closes it server-side |

Anything else → close `4400` (protocol violation) and a Sentry report, because it is a bug.

### 6.5 · Isolation

An Initech event arrives on the stream. `usr_42` has **no membership**, therefore **no registry
entry** in `byOrg['org_initech…']`. There is no lookup that could match him. Not filtered —
**unreachable**. Isolation is the absence of a code path, not the presence of a check.

---

## 7 · Scaling and operations

### 7.1 · Broadcast still needs chunking

A separate process means a broadcast no longer stalls the **API**. It can still stall **the socket
service's own** event loop, delaying pings and other clients' frames. Ten lines, from day one:

```ts
const BROADCAST_CHUNK = 200;
const frame = JSON.stringify(envelope);            // serialise ONCE, not per socket

let n = 0;
for (const entry of targets) {
  if (entry.socket.readyState === WebSocket.OPEN) entry.socket.send(frame);
  if (++n % BROADCAST_CHUNK === 0) await new Promise(setImmediate);
}
```

### 7.2 · Backpressure

Bound each connection's outbound queue. On overflow: set `needsResync`, send one `resync.required`,
and drop everything else for that socket until it acks. **One slow client degrades exactly itself** —
never block the broadcast loop, never grow the queue.

### 7.3 · The Postgres connection budget — a real file that must change

`src/infrastructure/database/safety/assert-connection-budget.ts` computes demand as
`(apiProcessCount + workerProcessCount) × DATABASE_POOL_MAX`, driven by
`DEPLOYMENT_API_REPLICA_COUNT` and `DEPLOYMENT_WORKER_REPLICA_COUNT`.

**A third service is not in that formula.** Left unchanged, the boot guard silently under-counts and
stops protecting you. Add `DEPLOYMENT_SOCKET_REPLICA_COUNT` and include it in the sum.

Keep the socket pool **small** — `DATABASE_POOL_MAX=5`. It only serves cache misses on session and
membership lookups; both are Redis-cached, so steady-state Postgres traffic is near zero.

### 7.4 · Graceful shutdown

```mermaid
sequenceDiagram
  autonumber
  participant K as Railway
  participant SK as socket service
  participant FE as clients

  K->>SK: SIGTERM
  SK->>SK: /readyz fails → LB stops routing new upgrades
  SK->>SK: stop the XREAD ingest loop
  SK->>FE: close(1001, { reconnect_after_ms: jitter(1000,15000) })
  Note over SK,FE: PER-CONNECTION jitter. Without it, N clients<br/>reconnect in the same instant onto a cold replica.
  SK->>SK: flush writers, close Redis + Postgres
  SK->>SK: exit (hard cap 20 s)
  FE->>FE: wait jittered delay → reconnect → refetch
```

### 7.5 · Metrics

| Metric | Why |
|---|---|
| `realtime_connections_active` | The autoscaling signal |
| `realtime_broadcast_duration_seconds` | Chunking is working (or is not) |
| `realtime_publish_to_deliver_seconds` | The headline SLI — `occurred_at` → wire, target p99 < 250 ms |
| `realtime_messages_dropped_total{reason}` | `slow_client` · `not_member` · `no_permission` |
| `realtime_stream_lag_seconds` | Ingest falling behind |

### 7.6 · Failure matrix

| What fails | Live updates | REST | Effect |
|---|---|---|---|
| One socket replica | Paused for its clients | ✅ fine | Reconnect + refetch |
| **All socket replicas** | ❌ stopped | ✅ **fine** | Product works, just not live |
| Redis | ❌ stopped | ✅ fine | Next refetch repairs the UI |
| `api` service | ❌ stopped | ❌ down | Total outage — as today |
| Socket-service deploy | 1–15 s gap | ✅ **fine** | Brief reconnect, jittered |
| **`api` deploy** | ✅ **unaffected** | brief | **This is why the third service exists** |

Every realtime failure degrades to today's behaviour. None creates a new class of outage.

---

## 8 · Files

```text
src/
├── socket.ts                                       + ADD  third entrypoint
├── socket-app.ts                                   + ADD  minimal Fastify (ws + cookie + health)
├── infrastructure/realtime/                        + ADD
│   ├── realtime.overview.md · realtime.constants.ts
│   ├── realtime-envelope.ts                        Zod schema + builder (ULID)
│   ├── realtime-publisher.ts                       publishRealtimeEvent() — THE indirection
│   ├── realtime-ticket.service.ts                  mint (api) / redeem via GETDEL (socket)
│   ├── realtime-registry.ts                        byUser · byOrg · closeForSession
│   ├── realtime-tier.ts                            tierFor() — PURE, no I/O
│   ├── realtime-broadcast.ts                       chunked, pre-serialised
│   ├── realtime-ingest.ts                          XREAD loop
│   └── __tests__/unit/                             incl. the payload-absent leak test
├── domains/realtime/                               + ADD  flat domain
│   ├── realtime.routes.ts · .controller.ts · .service.ts
│   ├── realtime.dto.ts · .validator.ts · .container.ts · .overview.md
│   └── __tests__/integration/realtime.integration.test.ts   ! validate:domain REQUIRES this
│
├── routes.ts                                       ~ EDIT  ticket route on api
├── domains/domain-containers.plugin.ts             ~ EDIT  wire the container
├── infrastructure/queue/commit-dispatch/*.ts       ~ EDIT  + 'realtime_event' variant + case
├── domains/notify/…/notification-dispatch.service.ts   ~ EDIT  schedule the task
├── domains/auth/…/auth-session.service.ts          ~ EDIT  on revoke → close sockets
├── infrastructure/database/safety/assert-connection-budget.ts  ~ EDIT  ! third service (§7.3)
├── shared/config/env-schema.ts                     ~ EDIT  ! new env vars
├── shared/constants/project-identity.constants.ts  ~ EDIT  OTEL_SERVICE_NAME_SOCKET
├── scripts/validators/domain/validate-domain.ts    ~ EDIT  ! FLAT_DOMAINS += 'realtime'
└── OVERVIEW.md · PATTERNS.md · FLOWS.md · POLICIES.md   ~ EDIT  ! narratives

package.json            ~ EDIT  @fastify/websocket · dev:socket · start:socket  (+ lockfile, same commit)
Dockerfile              ~ EDIT  FROM runtime AS socket
docker-compose.yml      ~ EDIT  socket service
.env.example            ~ EDIT  ! sync
.github/workflows/reusable-railway-deploy.yml   ~ EDIT  for service_name in api worker socket
docs/routes.txt + 3 route-catalog JSON files    ~ EDIT  ! regenerate
```

**Gates:** `knip` (`files: error` — land each file with its caller) · `tsdoc:check` (budget 0/0;
`@remarks` on service/publisher files) · `validate:domain` · snake_case body keys ·
`routes:catalog:check`.

---

## 9 · Build order

| Step | Do | Behind the flag |
|---|---|---|
| 1 | Envelope, constants, `tierFor()` + unit tests (incl. the leak test) | n/a — pure |
| 2 | `commit-dispatch` variant + executor + publisher | Deploy **alone first** — the task is persisted to Redis, so every running process must parse it before any is written |
| 3 | `env-schema.ts`, `.env.example`, connection budget (§7.3) | ✅ |
| 4 | `socket.ts`, `socket-app.ts`, Docker target, scripts, health | ✅ |
| 5 | Registry, broadcast, ingest, shutdown | ✅ |
| 6 | Ticket service + the `realtime` domain + Origin guard | ✅ `REALTIME_ENABLED=false` |
| 7 | `core-fe` client, router, provider, CSP | ✅ |
| 8 | Notification publisher + session-revoke hook | ✅ |
| 9 | Railway service, metrics, dashboards, narratives | — |

Everything merges inert. Turning it on is a config change, not a deploy.

**Realistic: 5–8 days** — a little more than the in-`api` variant because of the third service's
Docker/deploy/health wiring, and worth every hour of it for §7.6's last row.

---

## 10 · Keeping the exit cheap

If you ever outgrow Node for this, the move to Go is now genuinely mechanical, because the socket is
already an independent process with a defined interface. Four decisions preserve that:

1. **Version the envelope** (`v: 1`); never let a handler read a Drizzle row directly.
2. **Publish through one function** — `publishRealtimeEvent(envelope)`.
3. **Never write to Postgres from a socket handler.**
4. **Keep `tierFor()` pure** — no I/O. It ports to any language unchanged, and it is the one place
   where a bug is a cross-tenant leak.

**The number that says it is time:** connections per replica above ~10 k, or
`realtime_broadcast_duration_seconds` p99 above ~50 ms. Instrument both from day one — without them
you are guessing.

---

## 11 · `core-fe`

Unchanged from the Go plan's §9, with one addition and one deletion:

- **Add** `realtime-ticket.ts` — `POST /realtime/ticket` before connecting.
- **Delete** nothing else; the state machine, backoff, dedupe, router and lifecycle wiring are
  identical.
- **CSP:** the socket is on a different origin now, so `connect-src` must list it. Include **both**
  the `https://` and `wss://` forms — CSP3 says an `https:` source should match `wss:` for the same
  host, but WebKit has been inconsistent, and the failure mode is a silently blocked connection in
  Safari only.

> **The rule that matters most, restated:** the socket is a **cache-invalidation signal, not a data
> channel**. It never writes application data into a store — it tells TanStack Query what is stale.
