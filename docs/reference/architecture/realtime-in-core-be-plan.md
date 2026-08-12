# Realtime — a Go socket service inside the `core-be` repository

> **This is the chosen architecture.** The socket service is written in **Go** and lives **inside the
> `core-be` repository** as a third service alongside `api` and `worker` — one repo, one CI, one PR
> per change, two languages.
>
> **Status:** proposal. Nothing here is implemented yet.
> **Siblings:** [`realtime-implementation-map.md`](realtime-implementation-map.md) (the `core-be`
> TypeScript file map — still applies verbatim to the publish side) ·
> [`realtime-go-service-plan.md`](realtime-go-service-plan.md) (the *separate-repo* variant;
> superseded by this document, but its Appendix B/C and §9 remain the reference for the flow
> diagrams, the trade-off analysis, and the frontend design).

---

## 0 · Answers to the architecture review

Twelve questions were raised in design review. Each is answered directly below, with a pointer to
the section carrying the detail. **Two terms in Q9 could not be resolved from the codebase and are
flagged rather than guessed.**

| # | Question | Short answer | Detail |
|---|---|---|---|
| 1 | Separate realtime core, or inside the existing one? | **Separate process, same repository.** Not a separate repo | §0.1 |
| 2 | Pros and cons of splitting api / worker / socket | Table of both, honestly | §0.2 |
| 3 | How does it scale independently? How many instances? | By concurrent connections; formula + worked example | §0.3 |
| 4 | How is socket different from api and worker? | Different resource, different lifetime, different failure mode | §0.4 |
| 5 | Redis changes → how does the frontend update? | Seven hops; the socket **announces**, REST **delivers** | §0.5 |
| 6 | The realtime login flow | Login → REST paint → ticket → upgrade → handshake | §0.6 · §5 |
| 7 | Multi-organization routing | One socket, every membership; tiering by active org | §0.7 · §7 |
| 8 | Which event is handled where? | Backend emits, socket routes, frontend invalidates | §0.8 |
| 9 | Redis / exchanges / publishing | Answered for Redis; **two terms need clarification** | §0.9 |
| 10 | Can it run locally? | Yes — three terminals, no Docker required | §0.10 |
| 11 | Was the decision deeply considered? | Four options compared, two reversals recorded | §0.11 |
| 12 | Which flows must be documented? | All five, written | §0.12 |

### 0.1 · Why a separate realtime service at all

**Short answer:** because a WebSocket is a fundamentally different resource from an HTTP request,
and putting both in one process couples two things that should move independently.

Concretely, two problems appear the moment sockets live inside `api`:

1. **Fan-out blocks the event loop.** Node is one thread. Broadcasting to 10 000 connected members
   is a synchronous loop of ~10 000 `send()` calls — roughly 30–100 ms during which **no API request
   is processed**. Your p99 becomes hostage to your notification volume.
2. **Every API deploy disconnects every user.** At 10 000 users and five deploys a day that is
   ~200 000 manufactured reconnect requests, landing on the instance that just cold-started. The
   second-order effect is worse: teams start deploying less often.

Both are fixed by a **separate process**. Neither requires a separate *repository* — which is why we
land on "separate service, same repo" (§1.1). The full costing, including the case *for* keeping it
inside `api`, is in [`realtime-go-service-plan.md`](realtime-go-service-plan.md) Appendix C.

### 0.2 · Splitting into api / worker / socket — pros and cons

**Pros**

- Each service scales on its own signal (§0.3) instead of one dial serving three workloads.
- An `api` deploy no longer drops sockets; a socket deploy no longer interrupts requests.
- A socket bug (leaked goroutine, unbounded buffer) cannot take down the API.
- The socket service holds **no database credentials** — it is disposable by construction.
- It matches a pattern the repo already runs: `worker` is already a separate process, own Docker
  target, own Railway service.

**Cons — stated plainly**

- **Three services to deploy, monitor and page on** instead of two.
- **A second language** in the repo. Real onboarding cost; mitigated by `socket/` being invisible to
  every TypeScript gate (§2.1) and by `pnpm dev:socket`-style passthroughs (§3 Step 6).
- **An internal handshake endpoint** exists now, because Go cannot import `AuthorizationService`
  (§1.2). One more hop, one more thing to secure.
- **A wire contract** two languages must agree on — mitigated by shared fixtures in one directory
  (§4.5), which is the main reason same-repo beats separate-repo.
- **More local moving parts** — three processes instead of two (§0.10).

**Net:** the cons are one-time setup costs. The pros compound with traffic.

### 0.3 · Independent scaling, and how many instances

Each service scales on a different signal:

| Service | Scale on | Bound by |
|---|---|---|
| `api` | Request rate, p99 latency | CPU |
| `worker` | Queue depth, job lag | CPU / job concurrency |
| **`socket`** | **`realtime_connections_active`** | **Memory** |

**Sizing formula:**

```text
peak_concurrent_connections = daily_active_users
                            × fraction_with_a_tab_open      (typically 0.2–0.4 in B2B SaaS)
                            × tabs_per_user                 (typically 1.5–2.5)

instances = ceil(peak_concurrent / connections_per_instance) + 1   (+1 = headroom for a rolling deploy)
```

**Worked example — 20 000 DAU:**

```text
20 000 × 0.3 × 2   = 12 000 peak concurrent connections
12 000 / 50 000    = 0.24  → 1 instance is enough on capacity
                   → run 2 for availability, 3 during a deploy window
```

At **10× that traffic (200 000 DAU → 120 000 concurrent)** it is 3 instances + 1 = **4**. That is the
point worth making in review: **the socket tier stays small even at large user counts**, because idle
connections are cheap in Go (~25 KB each). The `api` tier at that scale would be far larger.

**What happens when socket traffic increases** — three regimes, in order:

1. **More connections** → add replicas. Linear, no coordination, no sticky sessions (§2.3).
2. **More events/second** → every replica decodes every event, so this cost is
   `events/s × replicas`. Watch `realtime_broadcast_duration_seconds`. Past ~10 000 events/s, shard
   the stream so each replica reads only the shards it has members for.
3. **Bigger single broadcasts** → chunk the fan-out and yield to the scheduler; already in the design.

**Autoscale target:** 70% of the *measured* per-instance ceiling. Treat 50 000 as a hypothesis to
falsify with a load test in week one, not a number to size production on.

### 0.4 · How socket differs from api and worker

| | `api` | `worker` | **`socket`** |
|---|---|---|---|
| Unit of work | A request (~50 ms) | A job (seconds–minutes) | **A connection (hours)** |
| Concurrency | Hundreds in flight | Tens | **Tens of thousands idle** |
| Bound by | CPU | CPU / IO | **Memory + file descriptors** |
| Triggered by | The user | A queue | **Another user's action** |
| If it stops | Total outage | Jobs backlog, catch up later | **Product still works, just not live** |
| State held | None (per request) | None (per job) | **The connection registry** |
| Deploy impact | Requests retry | Jobs resume | **Every client reconnects** |

They differ in **every row**. That is the argument for separation — not a preference for
microservices, but the observation that a process tuned for 50 ms request bursts and a process
holding 50 000 idle sockets for hours want different memory profiles, different scaling triggers and
different deploy semantics.

**The honest counter-argument:** at very low connection counts (< ~2 000) none of this is
measurable, and one fewer service is genuinely simpler. That case is made properly in Appendix C of
the sibling document — it was considered, not dismissed.

### 0.5 · Redis changes → how the frontend updates

**The exact flow, seven hops.** The critical detail is hop 2: **Postgres commits before anything is
announced.**

```mermaid
flowchart LR
  A["1 · Write<br/>POST /tasks/7/assign"] --> B["2 · Postgres COMMIT<br/><b>truth persisted FIRST</b>"]
  B --> C["3 · commit-dispatch<br/>task → Redis before<br/>the response returns"]
  C --> D["4 · XADD rt:events<br/>~200-byte envelope"]
  D --> E["5 · XREAD<br/>every socket replica"]
  E --> F["6 · registry + tierFor()<br/>→ ONE frame"]
  F --> G["7 · invalidateQueries<br/>→ REST refetch"]
  G -.->|"the data arrives HERE"| A
  style B fill:#4cc38a,color:#0f1117,stroke:none
  style F fill:#7aa2ff,color:#0f1117,stroke:none
```

**The part that surprises people:** the socket frame does **not** carry the data. It carries ids and
a counter — "notification `ntf_4k2…` happened, unread +1". The browser then refetches over normal
REST, through auth, RLS, serialization and pagination.

Three consequences, all good:

- **Ordering stops mattering.** "Refetch" is idempotent and commutative; applying deltas in order is
  not, and that is where realtime UIs rot.
- **A lost frame costs one stale panel**, repaired on the next refetch — so at-least-once delivery is
  sufficient and exactly-once (which does not exist) is not needed.
- **Turning it off is safe.** Cut hops 3–7 and the product degrades to today's refetch-on-navigate.

Full payloads for every hop: §6.

> **Note on the question's framing.** Redis is not the source of truth and nothing watches Redis for
> *data* changes. Postgres is the truth; Redis carries an **announcement** written after the commit.
> If a Redis key changed without a Postgres commit, nothing would or should be published — that is
> deliberate.

### 0.6 · The realtime login flow

Login itself is **unchanged** — plain HTTP, no sockets. The socket opens *afterwards*, and
deliberately last:

1. `POST /auth/login` → access token + `session_id` cookie.
2. `GET /notify/notifications` → **the UI is fully usable at this point.**
3. `POST /realtime/ticket` → a 30-second, single-use ticket.
4. `GET /v1/socket?ticket=…` → `Origin` checked, ticket redeemed with `GETDEL`.
5. Socket service calls `POST /internal/realtime/handshake` on `api` → memberships + permissions.
6. `101 Switching Protocols` → `connection.ready` frame with per-org unread counts.

**Why a ticket rather than the token?** Browsers cannot set headers on `new WebSocket()`, and a token
in a query string lands in access logs, proxy logs and `Referer`. A 30-second single-use ticket
bounds the exposure to something already spent.

**Why open the socket last?** Steps 1–2 are a complete working application. If step 3–6 fail, the
user sees a status dot and nothing else. Realtime is an enhancement, never a dependency.

Full payloads including the handshake exchange and every close code: §5.

### 0.7 · Multiple organizations

**The rule:** *delivery follows membership; presentation follows the active organization.*

One socket is registered under **every** active membership, with one flagged active:

| Situation | What crosses the wire | What the user sees |
|---|---|---|
| Event in the **active** org | `summary` + `payload` | Toast, badge, live list update |
| Event in an **inactive** org they belong to | `summary` **only** — ids and counts | A quiet dot: "Globex (3)" |
| Event in a **non-member** org | *nothing* — no registry entry exists | Nothing |

Two properties worth stating in review:

- **The summary tier is enforced by the encoder, not the renderer.** In Go the summary path marshals
  a **different struct with no `Payload` field at all** — not `omitempty`, *absent from the type*.
  Nothing can assign it and nothing can serialise it. A frontend bug cannot leak another tenant's
  title, because it never arrives.
- **Non-membership is structural silence.** There is no filter that could have a bug; there is simply
  no registry entry, therefore no code path that could deliver.

Switching orgs re-mints the token via `/auth/switch-to-organization` and sends one `active_org.set`
frame — **same socket, no reconnect**. Full payloads: §7.

### 0.8 · Where each event is handled

| Stage | Where | What it does | What it must NOT do |
|---|---|---|---|
| **Emit** | `api` (TS) — `notification-dispatch.service.ts`, post-commit | Build the envelope, schedule it on `commit-dispatch` | Emit before commit; block the request on Redis |
| **Transport** | Redis Streams | Durable, bounded announcement channel | Carry row data or PII |
| **Route** | `socket` (Go) — `hub` + `policy` | Membership lookup, `tierFor()`, serialise, send | Touch Postgres; apply business rules |
| **Apply** | `core-fe` — `realtime-router.ts` | Dedupe, bump the badge, `invalidateQueries` | Write server data into a store |
| **Deliver** | `api` (TS) — normal REST | Return the authoritative record | — |

**One rule per layer, and they are the comments worth writing:**

```ts
// api: publish AFTER commit, never inside the transaction, never blocking the request.
// socket: routing only — no business logic, no database, no writes.
// frontend: the frame marks a query stale; the REST refetch is what updates the UI.
```

**Documentation surfaces this repo already enforces**, and where each belongs:

- **TSDoc `@remarks`** on `realtime-publisher.ts` and `realtime.service.ts` — *Algorithm / Failure
  modes / Side effects*. Gated at 0/0 by `pnpm tsdoc:check`.
- **Route `schema.summary` / `description` / `tags`** on both new routes — drives OpenAPI, gated by
  `validate:route-schema-docs`.
- **`realtime.overview.md`** in each new module folder — the per-folder overview convention.
- **`src/FLOWS.md`** — the end-to-end flow narrative.
- **Go doc comments** on every exported symbol in `socket/internal/**`.

### 0.9 · Redis, exchanges and publishing

**What is answerable from the codebase:**

This repo has **no AMQP broker** — no RabbitMQ, no exchanges, no bindings. The messaging substrate
is **Redis**, used two ways, and it is worth separating them because they are often conflated:

| Use | Mechanism | Purpose |
|---|---|---|
| **BullMQ queues** | Redis lists/sorted sets, separate logical DB | Durable *work* — email, webhooks, retention. Pull-based, retried, DLQ'd |
| **Realtime stream** 🆕 | Redis **Streams** (`XADD` / `XREAD`) | Durable *announcements* — fan-out to socket replicas |

If you are thinking in AMQP terms, the mapping is:

| AMQP concept | Here |
|---|---|
| Exchange | The stream key `rt:events` |
| Routing key | `organization_id` + `scope` **inside** the envelope — every replica reads everything and filters locally |
| Queue per consumer | Each replica's own cursor into the stream |
| Ack | Not used — delivery is at-least-once and the client dedupes on the envelope ULID |

**Publishing** is deliberately not a new mechanism: it reuses `scheduleCommitDispatch`, which already
persists a validated task to Redis **before the HTTP response returns** and replays it via
`commit-dispatch-recovery.worker` if the process dies. That is a transactional outbox in all but
name, and building a second durability path alongside it would be a mistake.

> **⚠ Two terms could not be resolved and are not guessed here.** The review notes mention *"BEE
> exchanges"* and *"GoMakhi publishing"*. Neither appears anywhere in `core-be`, `core-fe`, the
> dependency tree, or the docs — they may be transcription artifacts, or systems outside these two
> repositories. **Please confirm what they map to.** If either is a real external broker or
> publishing pipeline the platform must integrate with, it changes §0.9 and possibly the transport
> choice, and should be resolved before implementation starts.

### 0.10 · Running it locally

**Yes, and it needs no Docker beyond what you already run.**

```sh
pnpm compose:up      # Postgres + Redis — already your normal setup
pnpm dev             # terminal 1 — api
pnpm dev:worker      # terminal 2 — worker
pnpm dev:socket      # terminal 3 — socket (Go, hot reload via air)
```

One-time setup: `brew install go golangci-lint`, plus two `go install` commands (§3 Steps 1–3).
About ten minutes.

**Is it difficult?** Two genuine friction points, both handled:

1. **Go must be installed.** Mitigated by the `pnpm dev:socket` / `test:socket` / `lint:socket`
   passthroughs — a TypeScript developer never types a `go` command, and anyone not touching
   `socket/` never needs the toolchain at all.
2. **`REDIS_KEY_PREFIX` must match** what `core-be` computes (`core:local:`). `ioredis` applies the
   prefix transparently; `go-redis` does not. Get it wrong and **nothing is delivered, with no error
   anywhere** — both processes look healthy. This is the single most likely local-setup failure;
   `pnpm setup:local` should write the value into the socket service's env file so it cannot drift.

**The checkpoint to aim for first:** with only the socket service running, a hand-written
`redis-cli XADD core:local:rt:events '*' …` should produce a frame in your browser. That proves
stream → ingest → registry → tier → socket with `api` not yet involved, and makes every later bug a
much smaller haystack.

### 0.11 · Whether the decision was actually interrogated

Four options were costed, and **the recommendation changed twice** during the analysis — which is
the evidence that it was not accepted blindly:

| Option | Verdict | Why |
|---|---|---|
| A · Sockets inside `api` | Rejected | Event-loop contention; every deploy drops every socket |
| B · Separate **Node** service | Viable | Fixes both, no new language. **Best choice below ~20 k connections** |
| C · Separate **Go** repo (`core-rt`) | Rejected | Contract fixtures in 3 repos, 3 PRs per envelope change |
| **D · Go service in the `core-be` repo** | **Chosen** | Fixes both, one PR per change, one fixtures directory |

**Two reversals worth recording**, because they came from reading the code rather than reasoning
from principle:

1. I initially specified a `SETNX`-guarded worker backstop for durable publishing. Reading
   `commit-dispatch.types.ts` showed the task is **already** persisted to Redis before the response
   returns and replayed on crash — the backstop was redundant. **Removed.**
2. I initially proposed protecting the internal handshake with the existing
   `api-key-auth.middleware.ts`. Reading it showed it resolves an **organization-scoped customer
   credential** and sets tenant context from it — binding the socket service to an arbitrary tenant.
   **Replaced** with a dedicated shared secret.

**Open questions that should be answered before or during implementation** — this design is not
claimed to be finished:

- Peak concurrent connections (§0.3). Without it, instance sizing is guesswork.
- The two unresolved terms in §0.9.
- Whether `REALTIME_MAX_SOCKETS_PER_USER = 10` matches real tab behaviour.
- Presence ("who is online") is **out of scope** — it needs cross-replica state aggregation and is a
  materially different problem.

**The strongest argument against this design** is that it adds a second language for a service that
Node could run at your likely scale. That is true, and Option B remains the right answer if the
connection count turns out to be small. The load test in week one should be treated as a genuine
decision point, not a formality.

### 0.12 · The flows that were asked for

All five, written with real payloads:

| Flow | Where |
|---|---|
| Login → live connection | §5 (payloads) · Appendix B.1 of the sibling doc (diagram) |
| Realtime data update | §6 |
| Multi-organization notification + switching | §7 |
| Event handling points | §0.8 |
| Frontend update behaviour | §0.5 · §11 |

---

## 1 · The shape

Three services, two languages, **one repository**:

| Service | Language | Entry | Scales by |
|---|---|---|---|
| `api` | TypeScript | `src/server.ts` | Request rate |
| `worker` | TypeScript | `src/worker.ts` | Queue depth |
| **`socket`** 🆕 | **Go** | **`socket/cmd/socket/main.go`** | **Concurrent connections** |

### 1.1 · Why the same repository, not a separate one

The earlier plan put Go in a separate `core-rt` repo. Same repo is better, and the reason is
specific:

| | Separate repo | **Same repo** |
|---|---|---|
| Wire contract | Fixtures duplicated in 3 repos, drift caught only by 3 CI runs | **One `contract/fixtures/` directory**, read by both the Go tests and the TS tests |
| Changing the envelope | 3 PRs, merge-ordered | **1 PR**, atomically |
| CI | Separate pipeline | One pipeline, path-filtered lanes |
| Versioning / release | Two release trains to keep compatible | One |
| Onboarding | Two repos to clone and wire | One |

The thing that made a separate repo look attractive — "the TS gates will fight Go" — turns out not
to be true (§2.1).

### 1.2 · What Go costs here, honestly

Go **cannot import** `AuthorizationService`. That is the one real consequence, and it brings back two
things the TypeScript-service variant did not need:

1. **`POST /api/v1/internal/realtime/handshake`** on the `api` service — the socket service asks
   "who is this ticket, and what are their memberships?"
2. **Contract fixtures** — a Go struct and a Zod schema must agree.

Both are much cheaper here than in the separate-repo design: the fixtures live in one directory, and
the endpoint plus its consumer change in a single PR.

**And Go buys one thing back:** because all authorization is delegated to that endpoint, **the socket
service needs no Postgres connection at all.** Redis and one internal HTTP call, nothing else. The
TypeScript variant, which imported services directly, needed its own database pool and a change to
the connection-budget guard. The Go service leaves `assert-connection-budget.ts` **untouched**.

| | TS third service | **Go third service** |
|---|---|---|
| Postgres pool | Needed (5–10 conns/replica) | **None** |
| `assert-connection-budget.ts` | Must change | **Unchanged** |
| Internal handshake endpoint | Not needed | Needed |
| Contract fixtures | Not needed | Needed (one directory) |
| Connections per replica | ~10–20 k | **~50 k** |
| Memory per connection | ~40–150 KB | **~25 KB** |

---

## 2 · Repo layout

### 2.1 · Go goes at the root, never inside `src/`

Every TypeScript gate in this repo is scoped to `src/` and `tooling/`. Verified:

| Gate | Scope | Sees `socket/`? |
|---|---|---|
| Biome | `files.includes: ["src/**","tooling/**"]`, `biome check src tooling` | ❌ no |
| `tsc` | `include: ["src/**/*.ts","tooling/**/*.ts"]` | ❌ no |
| knip | `project: ["src/**/*.ts","tooling/**/*.{ts,mjs}"]` | ❌ no |
| `validate:domain` | `src/domains` | ❌ no |
| `tsdoc:check` | `src/**/*.ts` | ❌ no |
| SonarQube | `sonar.sources=src` | ❌ no |

**So a top-level `socket/` directory needs zero exclusions.** Not one existing config changes. Put
the Go tree anywhere under `src/` and you would be adding exclusions to six gates forever.

```text
core-be/
├── src/                          # TypeScript — api + worker (untouched by this feature's runtime)
├── tooling/                      # TypeScript
├── socket/                       # ← Go service. Invisible to every TS gate.
│   ├── go.mod  go.sum
│   ├── Makefile
│   ├── cmd/socket/main.go        # the ONE binary: wiring + shutdown
│   └── internal/                 # compiler-enforced private
│       ├── config/               # env → typed struct, validated at boot
│       ├── protocol/             # envelope + frames + close codes (reads ../contract/fixtures)
│       ├── auth/                 # ticket redemption, handshake client, deadline
│       ├── hub/                  # registry: sharded maps, org/user indexes
│       ├── conn/                 # per-connection reader/writer/backpressure/heartbeat
│       ├── ingest/               # Redis Streams consumer
│       ├── policy/               # tierFor() — full / summary / drop
│       ├── obs/                  # prometheus, slog, sentry
│       └── health/               # /healthz /readyz /metrics
├── contract/fixtures/*.json      # ← SHARED. Go tests and TS tests both read these.
├── Dockerfile                    # node — api + worker targets (unchanged)
├── Dockerfile.socket             # ← Go build → distroless
└── package.json                  # + dev:socket / build:socket passthroughs
```

### 2.2 · Service topology

```mermaid
flowchart TB
  FE["core-fe · browser"]

  subgraph REPO["core-be — ONE repository"]
    direction LR
    API["<b>api</b> · TypeScript<br/>src/server.ts<br/>REST · auth · RLS<br/><i>+ internal handshake</i>"]
    SOCK["<b>socket</b> · Go 🆕<br/>socket/cmd/socket<br/>WS · registry · tiering<br/><i>NO database access</i>"]
    WORK["<b>worker</b> · TypeScript<br/>src/worker.ts<br/>BullMQ jobs"]
  end

  PG[("Postgres")]
  RD[("Redis")]

  FE ===|"1 · REST — all reads/writes"| API
  FE <-->|"5 · WebSocket frames"| SOCK
  API ==>|"2 · commit"| PG
  API -->|"3 · XADD after commit"| RD
  RD -->|"4 · XREAD"| SOCK
  SOCK -.->|"handshake: who is this?<br/>(once per connection)"| API
  WORK --- RD
  WORK --- PG

  style SOCK fill:#7aa2ff,color:#0f1117,stroke:none
  style API fill:#4cc38a,color:#0f1117,stroke:none
  style WORK fill:#c792ea,color:#0f1117,stroke:none
```

Note the dotted line: **the socket service never touches Postgres.** It asks `api`, once per
connection. That is what keeps it stateless, credential-free and safe to restart carelessly.

### 2.3 · Scalability

Socket replicas are **interchangeable** — every replica reads the same Redis stream and filters
against its own in-memory registry:

- **No sticky sessions.** Any client lands on any replica.
- **No routing table.** A replica that does not hold the target drops the event.
- **Adding a replica is free.** It starts reading and accepting.

Protect this property: the moment any code needs to know *which* replica holds a user, it is gone.

| Dial | Signal | Target |
|---|---|---|
| `socket` replicas | `realtime_connections_active` | ~50 k conns/replica on 2 vCPU / 2 GB — **measure in week 1** |
| `api` replicas | Request rate / p99 | Unchanged by this feature |
| Redis | `realtime_stream_lag_seconds` | p99 < 1 s |

---

## 3 · Installation — step by step

### Step 1 · Go toolchain

**Go 1.24 or newer** (current stable at <https://go.dev/dl/>).

```sh
brew install go golangci-lint                          # macOS
go install golang.org/x/vuln/cmd/govulncheck@latest    # official CVE scanner (reachability-aware)
go install github.com/air-verse/air@latest             # hot reload — the tsx watch equivalent
```

**Add `$(go env GOPATH)/bin` to your `PATH`** — every `go install` binary lands there, and forgetting
this is the classic "installed but command not found".

Verify: `go version` · `golangci-lint --version`.

VS Code: install the `golang.go` extension. Formatting is not a debate in Go — `gofmt` is canonical
and runs on save. There is no Prettier/Biome argument to have.

### Step 2 · Initialise the module

```sh
mkdir -p socket/cmd/socket socket/internal/{config,protocol,auth,hub,conn,ingest,policy,obs,health}
mkdir -p contract/fixtures
cd socket
go mod init github.com/nikunjmavani/core-be/socket
```

The module path includes `/socket` because the Go module is a **subdirectory** of the repo, not the
repo root. This matters: a `go.mod` at the repo root would make Go tooling try to own the whole tree.

### Step 3 · Dependencies

```sh
cd socket
go get github.com/coder/websocket           # WebSocket server — context-aware, no unsafe
go get github.com/redis/go-redis/v9         # Redis client with Streams support
go get github.com/oklog/ulid/v2             # ULID envelope ids (k-sortable, dedupe key)
go get github.com/prometheus/client_golang  # /metrics — same vocabulary as core-be
go get github.com/getsentry/sentry-go       # same DSN and release tagging

go get -t go.uber.org/goleak                # goroutine-leak detection — DO NOT SKIP
go get -t github.com/alicebob/miniredis/v2  # in-memory Redis for tests
go mod tidy
```

Seven libraries. HTTP, JSON, crypto, concurrency and structured logging (`log/slog`) are all
standard library.

> **`goleak` is not optional.** This service spawns two goroutines per connection. A leak is the most
> likely production bug, and `goleak.VerifyTestMain` catches it in CI instead of at 03:00.

**Commit `go.mod` and `go.sum` together**, same atomicity rule as `pnpm-lock.yaml`.

### Step 4 · The entrypoint

`socket/cmd/socket/main.go` — wiring and shutdown only:

```go
package main

import (
    "context"
    "errors"
    "log/slog"
    "net/http"
    "os"
    "os/signal"
    "syscall"
    "time"
)

func main() {
    slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))

    cfg := config.MustLoad()          // fail fast on missing/invalid env, like env-schema.ts
    hub := hub.New()
    ingest := ingest.Start(cfg, hub)  // XREAD loop

    mux := http.NewServeMux()
    mux.HandleFunc("GET /healthz", health.Live)
    mux.HandleFunc("GET /readyz", health.Ready(ingest))
    mux.Handle("GET /metrics", obs.MetricsHandler())
    mux.HandleFunc("GET /v1/socket", conn.Upgrade(cfg, hub))

    server := &http.Server{
        Addr:              ":" + cfg.Port,
        Handler:           mux,
        ReadHeaderTimeout: 5 * time.Second, // slow-loris guard
    }

    go func() {
        slog.Info("realtime.socket.listening", "addr", server.Addr)
        if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
            slog.Error("realtime.socket.listen_failed", "error", err)
            os.Exit(1)
        }
    }()

    stop := make(chan os.Signal, 1)
    signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
    <-stop

    slog.Info("realtime.socket.shutdown.start")
    health.MarkNotReady()                        // /readyz fails → LB drains
    ingest.Stop()
    hub.CloseAll(1001, jitteredReconnect)        // per-connection jitter — see §7.4
    ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
    defer cancel()
    _ = server.Shutdown(ctx)
}
```

### Step 5 · Makefile

```makefile
# NOTE: Make needs REAL TABS. If your paste lands as spaces:
#   sed -i '' $$'s/^    /\t/' Makefile     (macOS)
.PHONY: run dev build test lint vuln check

run:    ; go run ./cmd/socket
dev:    ; air
build:  ; CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/socket ./cmd/socket
test:   ; go test -race -count=1 ./...
lint:   ; gofmt -l . && go vet ./... && golangci-lint run
vuln:   ; govulncheck ./...
check:  lint test vuln
```

`make check` is the Go equivalent of `pnpm ci:local`. **`-race` is not optional** — this service
mutates shared maps from many goroutines, and the race detector is the only thing that reliably
catches a missing lock.

### Step 6 · package.json passthroughs

So a TypeScript developer never has to remember Go commands:

```jsonc
"dev:socket":    "cd socket && air",
"build:socket":  "cd socket && make build",
"test:socket":   "cd socket && make test",
"lint:socket":   "cd socket && make lint",
"check:socket":  "cd socket && make check",
```

### Step 7 · Dockerfile.socket

```dockerfile
# ---- build ----
FROM golang:1.24-alpine AS build
WORKDIR /src
COPY socket/go.mod socket/go.sum ./
RUN go mod download
COPY socket/ ./
COPY contract/ /contract/
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/socket ./cmd/socket

# ---- runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/socket /socket
EXPOSE 8080
USER nonroot:nonroot
ENTRYPOINT ["/socket"]
```

~15 MB, no shell, no package manager, effectively no base-image CVE surface. Boots in milliseconds —
which is what lets a rolling deploy re-absorb 50 000 reconnects quickly.

> `.dockerignore` currently excludes `node_modules`, `dist`, `docs/`, `*.md` and env files. It does
> **not** exclude `socket/` or `contract/`, so both are already in the build context. Nothing to
> change.

### Step 8 · Local stack

```yaml
# docker-compose.yml
socket:
  profiles: ['smoke']
  build: { context: ., dockerfile: Dockerfile.socket }
  ports: ['8080:8080']
  depends_on:
    redis: { condition: service_healthy }
  environment:
    REDIS_URL: redis://redis:6379
    REDIS_KEY_PREFIX: 'core:development:'
    CORE_BE_INTERNAL_URL: http://api-smoke:3000
```

Day to day you do not need Docker — `pnpm compose:up`, then `pnpm dev`, `pnpm dev:worker`,
`pnpm dev:socket` in three terminals.

### Step 9 · CI lane

A path-filtered lane in `.github/workflows/pr-ci.yml`, folded into the existing `Quality gate`
aggregate so the merge rule keeps working:

```yaml
socket-go:
  if: needs.changes.outputs.socket == 'true'
  runs-on: ubuntu-latest
  defaults: { run: { working-directory: socket } }
  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-go@v5
      with: { go-version: '1.24', cache: true, cache-dependency-path: socket/go.sum }
    - run: test -z "$(gofmt -l .)" || (gofmt -l . && exit 1)
    - run: go vet ./...
    - uses: golangci/golangci-lint-action@v6
      with: { working-directory: socket }
    - run: go test -race -count=1 ./...
    - run: go build ./...
    - uses: golang/govulncheck-action@v1
```

Add `socket: ['socket/**', 'contract/**']` to the path filter, and `socket-go` to the `Quality gate`
`needs` list.

### Step 10 · Railway

Third service from `Dockerfile.socket`, `RAILWAY_SOCKET_SERVICE_ID` as a secret, and in
`reusable-railway-deploy.yml` (~line 351) change `for service_name in api worker` to
`for service_name in api worker socket`.

### Step 11 · Environment

| Variable | Where | Default | Purpose |
|---|---|---|---|
| `REALTIME_ENABLED` | api + socket | `false` | Kill switch — gates the route *and* publishing |
| `REALTIME_TICKET_TTL_SECONDS` | api | `30` | Connect-ticket lifetime |
| `REALTIME_PUBLIC_URL` | api | — | `wss://…` returned in the ticket response |
| `REALTIME_INTERNAL_SECRET` | api + socket | — | Shared secret for the handshake endpoint |
| `REALTIME_CROSS_ORG_TITLES` | socket | `false` | Never leak another tenant's free text |
| `SOCKET_PORT` | socket | `8080` | — |
| `REDIS_KEY_PREFIX` | socket | — | **Must match `resolveRedisKeyPrefix()`** (§3.1) |
| `ALLOWED_ORIGINS` | socket | — | The CSWSH allowlist |

The TypeScript-side variables go through `env-schema.ts` + `pnpm tool:sync-env-example --fix`. The Go
side validates its own in `internal/config` and **fails fast** — a misconfigured socket service must
refuse to start, not start silently.

> ### 🔴 The one setting that breaks everything silently
>
> `REDIS_KEY_PREFIX` must equal what `core-be` computes in `resolveRedisKeyPrefix()` —
> `core:<NODE_ENV>:`. **`ioredis` applies that prefix transparently; `go-redis` does not** — you must
> prepend it yourself in every key. Get it wrong and there is no error anywhere: `api` writes to
> `core:production:rt:events`, the socket blocks on `rt:events`, both processes look healthy, and
> nothing is ever delivered. Build the prefix helper once in `internal/config` and never construct a
> raw key outside it.

---

## 4 · How the socket is set up

### 4.1 · Authentication — ticket, then handshake

Go cannot call `AuthorizationService`, so authorization is delegated to `api` exactly once per
connection.

```mermaid
flowchart LR
  A["core-fe"] -->|"1 · POST /realtime/ticket (Bearer)"| B["api · TS"]
  B -->|"2 · SETEX rt:ticket 30s"| R[("Redis")]
  B -->|"3 · 201 { ticket, socket_url }"| A
  A -->|"4 · GET /v1/socket?ticket=… + Origin"| C["socket · Go"]
  C -->|"5 · Origin allowlist check"| C
  C -->|"6 · POST /internal/realtime/handshake"| B
  B -->|"7 · GETDEL ticket · verify session · load memberships"| R
  B -->|"8 · 201 { user, memberships[], expires_at }"| C
  C -->|"9 · 101 + connection.ready"| A
  style C fill:#7aa2ff,color:#0f1117,stroke:none
```

Three security properties, none optional:

1. **The `Origin` check is the whole CSWSH defence.** WebSocket upgrades are **not** covered by
   CORS — browsers send them cross-origin with no preflight. Validate `Origin` against
   `ALLOWED_ORIGINS` before anything else.
2. **The ticket is single-use**, redeemed with `GETDEL`, 30-second TTL. A stolen ticket is already
   spent, and the real credential never appears in a URL or an access log.
3. **The socket's lifetime is bounded by the credential's.** Store `expires_at` per connection and
   close with `4401` past it. A socket authenticated at 09:00 must not still be delivering at 17:00 —
   this is the most common WebSocket security bug.

### 4.2 · The internal handshake endpoint

Protect it with the dedicated `REALTIME_INTERNAL_SECRET` (constant-time compare, `X-Realtime-Secret`)
plus private networking — **not** the customer-facing `api-key-auth.middleware.ts`, which resolves an
*organization-scoped* credential and would bind the socket service to some arbitrary tenant.

### 4.3 · The registry

```go
// 256 shards keyed by FNV(userID) — a broadcast touches one shard's lock,
// so 50k connections never contend on a single mutex.
type Hub struct{ shards [256]*shard }

type shard struct {
    mu     sync.RWMutex
    byUser map[UserID]map[ConnID]*Conn
    byOrg  map[OrgID]map[ConnID]*Conn   // EVERY membership, not just the active one
}

type Conn struct {
    id       ConnID
    userID   UserID
    out      chan []byte              // BOUNDED — cap 64
    deadline atomic.Int64             // unix ms; from handshake expires_at
    state    atomic.Pointer[connState] // memberships + activeOrg, swapped WHOLESALE
    resync   atomic.Bool
}
```

`connState` is **swapped, never mutated** — an org switch builds a whole new state and does one
`atomic.Pointer.Store`. The fan-out path does one atomic load and takes no lock, so switching orgs
cannot stall delivery and delivery cannot observe a half-updated membership set.

### 4.4 · Backpressure

Bounded `out` channel per connection. On overflow: set `resync`, push one `resync.required`, drop
everything else for that socket until it acks.

```go
select {
case conn.out <- frame:
default:
    if conn.resync.CompareAndSwap(false, true) {
        conn.forcePush(protocol.ResyncRequired{})
    }
    obs.Dropped.WithLabelValues("slow_client").Inc()
}
```

Never block the fan-out (that stalls everyone) and never grow the queue (that is how you OOM).
**One slow client degrades exactly itself.**

### 4.5 · Contract fixtures — the one thing two languages must agree on

`contract/fixtures/*.json` — one file per event type and close scenario. Two tests read the same
directory:

- `socket/internal/protocol/fixtures_test.go` — round-trips each through the Go structs
- `src/tests/unit/realtime/contract-fixtures.unit.test.ts` — round-trips each through the Zod schema

Add a field on one side without the other and **both lanes fail in the same PR**. This is the whole
reason same-repo beats separate-repo, and it costs no build tooling.

---

## 5 · Flow 1 — Login to live connection, with payloads

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant FE as core-fe
  participant API as api (TS)
  participant PG as Postgres
  participant RD as Redis
  participant SK as socket (Go)

  rect rgba(122,162,255,0.08)
    Note over U,PG: PHASE 1 — AUTH (no sockets)
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
    API->>RD: SETEX rt:ticket 30s
    API-->>FE: 201 { ticket, socket_url }
    FE->>SK: GET /v1/socket?ticket=… + Origin
    SK->>SK: Origin allowlist check
    SK->>API: POST /internal/realtime/handshake
    API->>RD: GETDEL — single use
    API->>PG: session + memberships + permissions
    API-->>SK: 201 { user, memberships[], expires_at }
    SK-->>FE: 101 + connection.ready
  end
```

### 5.1 · `POST /api/v1/auth/login`

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
  "data": { "access_token": "eyJhbGciOiJSUzI1NiIsImtpZCI6ImsxIn0.eyJzdWIiOiJ1c3Jf…" },
  "meta": { "request_id": "req_01J8ZQ9V3K2M7B4X6R0T8N5C1D" }
}
```

Decoded JWT claims:

```json
{
  "sub": "usr_2b8f4d6a1c3e5g7h9",
  "org": "org_7hk3n2p9qw4r8t6y1u5i0",
  "iss": "core-be", "aud": "core-fe",
  "iat": 1770000000, "exp": 1770000900,
  "jti": "b6f1…"
}
```

### 5.2 · `POST /api/v1/realtime/ticket`

**Request** — `Authorization: Bearer …`, `Origin: https://app.example.com`, no body. Idempotency
header **not** required: it mints a throwaway credential, not business state.

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

What lands in Redis — note the prefix, which the Go side must reproduce:

```text
SETEX core:production:rt:ticket:rtk_9f2c7a1e4b8d3061af52c9e7 30
  {"user_id":"usr_2b8f4d6a1c3e5g7h9",
   "session_id":"ses_5k2m8p6q1w3e5r7t9",
   "organization_id":"org_7hk3n2p9qw4r8t6y1u5i0"}
```

| Status | When | `code` |
|---|---|---|
| `401` | Missing/expired bearer, or session revoked | `unauthorized` |
| `403` | `Origin` not allowlisted | `origin_not_allowed` |
| `429` | Mint rate limit | `rate_limit_exceeded` |
| `503` | `REALTIME_ENABLED=false` | `service_unavailable` |

### 5.3 · The upgrade

```http
GET /v1/socket?ticket=rtk_9f2c7a1e4b8d3061af52c9e7 HTTP/1.1
Host: rt.example.com
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==
Sec-WebSocket-Version: 13
Origin: https://app.example.com
```

### 5.4 · The internal handshake — Go → TypeScript

**Request**

```http
POST /api/v1/internal/realtime/handshake HTTP/1.1
X-Realtime-Secret: <REALTIME_INTERNAL_SECRET>
Content-Type: application/json
```

```json
{ "ticket": "rtk_9f2c7a1e4b8d3061af52c9e7" }
```

**Response — `201 Created`**

```json
{
  "data": {
    "user_id": "usr_2b8f4d6a1c3e5g7h9",
    "session_id": "ses_5k2m8p6q1w3e5r7t9",
    "expires_at": "2026-08-12T09:29:22.000Z",
    "active_organization_id": "org_7hk3n2p9qw4r8t6y1u5i0",
    "memberships": [
      {
        "organization_id": "org_7hk3n2p9qw4r8t6y1u5i0",
        "role": "admin",
        "permissions": ["notification.read", "billing.read", "member.manage"],
        "unread_count": 0
      },
      {
        "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m",
        "role": "member",
        "permissions": ["notification.read", "document.read"],
        "unread_count": 2
      }
    ],
    "limits": { "max_connections": 10 }
  },
  "meta": { "request_id": "req_01J8ZQB0N3…" }
}
```

`expires_at` becomes the connection's hard deadline (§4.1). Everything else populates the registry.

### 5.5 · `101` and the first frame

```http
HTTP/1.1 101 Switching Protocols
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=
```

```json
{
  "v": 1,
  "type": "connection.ready",
  "id": "01J8ZQB4T7X2N9…",
  "occurred_at": "2026-08-12T09:14:22.481Z",
  "data": {
    "active_organization_id": "org_7hk3n2p9qw4r8t6y1u5i0",
    "heartbeat_interval_ms": 25000,
    "memberships": [
      { "organization_id": "org_7hk3n2p9qw4r8t6y1u5i0", "unread_count": 0 },
      { "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m", "unread_count": 2 }
    ]
  }
}
```

That one frame paints `Acme ✓ · Globex (2)` on the switcher — including notifications that arrived
while the user was completely offline, because the counts come from Postgres, not the live stream.

**Close codes**

| Code | When | Client |
|---|---|---|
| `4401` | Ticket invalid/expired/spent, or the deadline passed | Mint a fresh ticket, reconnect |
| `4403` | No memberships, or org suspended | Do not reconnect |
| `4408` | No valid ticket within 5 s | Reconnect with a fresh ticket |
| `4429` | Per-user connection cap | Back off ≥ 60 s |
| `1001` | Deploy — carries `reconnect_after_ms` | Reconnect after the jittered delay |

---

## 6 · Flow 2 — A data update, with payloads

```mermaid
sequenceDiagram
  autonumber
  actor TM as Teammate
  participant API as api (TS)
  participant PG as Postgres
  participant CD as commit-dispatch
  participant RD as Redis Streams
  participant SK as socket (Go)
  participant FE as core-fe (you)

  TM->>API: POST /api/v1/tasks/7/assign
  API->>PG: BEGIN · UPDATE task · INSERT notification
  PG-->>API: COMMIT ✔ truth persisted FIRST
  API->>CD: scheduleCommitDispatch { realtime_event, envelope }
  CD->>RD: task persisted BEFORE the response returns
  API-->>TM: 201 Created
  CD->>RD: XADD rt:events
  RD-->>SK: XREAD (all replicas)
  SK->>SK: registry lookup + tierFor() → Full
  SK-->>FE: ONE frame
  FE->>FE: dedupe · badge +1 · invalidateQueries
  FE->>API: GET /api/v1/notify/notifications
  API-->>FE: 200 authoritative list — the server WINS
  opt user opens it
    FE->>API: PATCH /notify/notifications/{id}/read
    Note over FE,API: REST, never a socket frame
  end
```

### 6.1 · The write

```http
POST /api/v1/tasks/7/assign HTTP/1.1
Authorization: Bearer <teammate token>
X-Idempotency-Key: 4f2c-…
```

```json
{ "assignee_id": "usr_2b8f4d6a1c3e5g7h9" }
```

`201 Created`. The teammate's request is done; it knows nothing about sockets.

### 6.2 · The stream entry

```text
XADD core:production:rt:events MAXLEN ~ 10000 * v 1 payload '{…}'
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
  "summary": { "resource_id": "ntf_4k2m8p6q1w3e5r7t9", "unread_count_delta": 1 },
  "payload": {
    "type": "TASK_ASSIGNED",
    "title": "Task 7 assigned to you",
    "action_url": "/organization/acme/tasks/7"
  }
}
```

### 6.3 · The frame the browser receives

Acme **is** the active org → `tierFor()` returns `Full`:

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

`scope` and `target_user_id` are **stripped before sending** — routing metadata is the server's
business, and echoing another user's id to a client is a needless disclosure.

### 6.4 · The refetch — where the data actually arrives

```http
GET /api/v1/notify/notifications?limit=20 HTTP/1.1
Authorization: Bearer eyJhbGciOiJSUzI1NiIs…
```

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

> **This is the point of the whole design.** The frame carried ~200 bytes of "something changed". The
> *data* came over REST, through auth, RLS, serialization and pagination — one code path, already
> tested. That is why a dropped, duplicated or reordered frame costs at most one extra refetch, and
> why at-least-once delivery is sufficient.

### 6.5 · Mark as read — REST, never a frame

```http
PATCH /api/v1/notify/notifications/ntf_4k2m8p6q1w3e5r7t9/read HTTP/1.1
```

```json
{
  "data": { "id": "ntf_4k2m8p6q1w3e5r7t9", "is_read": true, "read_at": "2026-08-12T09:33:10.004Z" },
  "meta": { "request_id": "req_01J8ZQE7P…" }
}
```

A socket write would bypass validation, idempotency, rate limits, audit and the RLS context wrapper —
and would force the Go service to hold a write-capable database connection, destroying the property
that makes it disposable.

---

## 7 · Flow 3 — Multi-organization, with payloads

Dakshil: admin in **Acme** (active), member in **Globex** (inactive), no membership in **Initech**.

```mermaid
sequenceDiagram
  autonumber
  actor CG as Colleague in Globex
  participant API as api (TS)
  participant RD as Redis
  participant SK as socket (Go)
  participant FE as core-fe
  actor U as Dakshil (in Acme)

  Note over SK: One socket, registered under BOTH memberships.<br/>acme = ACTIVE · globex = inactive · initech = NO ENTRY

  rect rgba(199,146,234,0.10)
    CG->>API: POST /api/v1/docs/9/mention → usr_42
    API->>RD: commit, then XADD (organization_id = globex)
    RD-->>SK: XREAD
    SK->>SK: member of globex ✓ but NOT active → tierFor() = Summary
    SK-->>FE: frame WITHOUT payload
    Note over SK,FE: payload omitted at SERIALISATION —<br/>a different struct is marshalled.
    FE-->>U: quiet dot — Globex (3)
  end

  rect rgba(229,165,75,0.10)
    U->>FE: click "Globex (3)"
    FE->>API: POST /api/v1/auth/switch-to-organization
    API-->>FE: 201 new access_token (org = globex)
    FE->>SK: frame active_org.set
    SK->>SK: verify membership, atomic connState swap
    SK-->>FE: frame active_org.changed
    FE->>API: GET /notify/notifications (globex token)
    Note over FE,SK: SAME socket. No reconnect. Roles reversed.
  end
```

### 7.1 · The inactive-org frame — note what is missing

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

**No `payload` key at all** — not `null`, *absent*. The title ("Priya mentioned you in *Q3 layoffs —
draft*") is another tenant's user-authored content and never leaves the socket service. The UI renders
"New activity in Globex" from `organization_id` alone.

In Go this is enforced by marshalling a **different struct**:

```go
type summaryFrame struct {
    V              int      `json:"v"`
    ID             string   `json:"id"`
    Type           string   `json:"type"`
    OccurredAt     string   `json:"occurred_at"`
    OrganizationID string   `json:"organization_id"`
    Summary        Summary  `json:"summary"`
    // no Payload field — it cannot be serialised because it does not exist
}
```

That is stronger than `omitempty` on a shared struct: the field is not merely skipped, it is
**absent from the type**. A frontend bug cannot leak it because it never arrives, and a backend bug
cannot leak it because there is nothing to assign. The test asserting the key is absent for an
inactive-org event is non-negotiable.

### 7.2 · The switch

```http
POST /api/v1/auth/switch-to-organization HTTP/1.1
Authorization: Bearer <acme-scoped token>
```

```json
{ "organization_id": "org_9wq4r8t6y1u5i0p3n2k7m" }
```

**`201 Created`**

```json
{
  "data": {
    "access_token": "eyJhbGciOiJSUzI1NiIs…<org claim = globex>…",
    "active_organization": { "id": "org_9wq4r8t6y1u5i0p3n2k7m", "name": "Globex", "slug": "globex" },
    "my_permissions": ["notification.read", "document.read"],
    "global_role": null
  },
  "meta": { "request_id": "req_01J8ZQG1K…" }
}
```

Admin in Acme, **member** in Globex, with a correspondingly smaller permission set. The new token —
not the socket frame — is what authorizes the REST reads that follow.

### 7.3 · Telling the socket

**Client → server**

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

Rejected with `4403` if the org is not in the socket's membership set. `active_org.set` is a
**presentation hint**, never an authorization decision.

### 7.4 · The complete client → server frame set

| Frame | Body | Effect |
|---|---|---|
| `auth.refresh` | `{ access_token }` | Re-arms the connection deadline with the new token's `exp` |
| `active_org.set` | `{ organization_id }` | Flips the active membership. No reconnect |
| `resync.ack` | `{}` | Clears the server-side resync flag after refetching |
| `ping` | `{}` | Optional; protocol ping/pong is primary |

Anything else → close `4400` and a Sentry report, because it is a bug.

### 7.5 · Isolation

An Initech event arrives on the stream. `usr_42` has **no membership** → **no entry** in
`byOrg["org_initech…"]`. No lookup can match him. Not filtered — **unreachable**. Isolation is the
absence of a code path, not the presence of a check.

---

## 8 · Operations

### 8.1 · Graceful shutdown

```mermaid
sequenceDiagram
  autonumber
  participant K as Railway
  participant SK as socket (Go)
  participant FE as clients

  K->>SK: SIGTERM
  SK->>SK: /readyz fails → LB stops routing new upgrades
  SK->>SK: stop the XREAD ingest loop
  SK->>FE: close(1001, reconnect_after_ms = jitter(1000,15000))
  Note over SK,FE: PER-CONNECTION jitter. Without it, 50k clients<br/>reconnect in the same instant onto a cold replica.
  SK->>SK: flush writers, close Redis
  SK->>SK: exit (hard cap 20 s)
  FE->>FE: wait jittered delay → reconnect → refetch
```

### 8.2 · Metrics

| Metric | Why |
|---|---|
| `realtime_connections_active` | Autoscaling signal |
| `realtime_publish_to_deliver_seconds` | Headline SLI — `occurred_at` → wire, p99 < 250 ms |
| `realtime_broadcast_duration_seconds` | Fan-out health |
| `realtime_messages_dropped_total{reason}` | `slow_client` · `not_member` · `no_permission` |
| `realtime_stream_lag_seconds` | Ingest falling behind |
| `realtime_handshake_duration_seconds` | The `api` round-trip |

### 8.3 · Failure matrix

| What fails | Live updates | REST | Effect |
|---|---|---|---|
| One socket replica | Paused for its clients | ✅ fine | Reconnect + refetch |
| **All socket replicas** | ❌ stopped | ✅ **fine** | Product works, just not live |
| Redis | ❌ stopped | ✅ fine | Next refetch repairs the UI |
| `api` service | ❌ stopped (no handshake) | ❌ down | Total outage — as today |
| Socket deploy | 1–15 s gap | ✅ fine | Brief reconnect, jittered |
| **`api` deploy** | Existing sockets survive; new connects fail briefly | brief | Sockets are **not** dropped |

Every realtime failure degrades to today's behaviour. None creates a new class of outage.

---

## 9 · Files

```text
socket/                                          + ADD  the whole Go tree (§2.1)
contract/fixtures/*.json                         + ADD  shared Go ↔ TS golden fixtures
Dockerfile.socket                                + ADD
.gitignore                                       ~ EDIT  socket/bin/ · socket/tmp/ (air)

src/
├── infrastructure/realtime/                     + ADD  (TypeScript, publish side)
│   ├── realtime.overview.md · realtime.constants.ts
│   ├── realtime-envelope.ts                     Zod schema — must match the Go struct
│   ├── realtime-publisher.ts                    publishRealtimeEvent() — XADD
│   ├── realtime-ticket.service.ts               mint (SETEX) / redeem (GETDEL)
│   └── __tests__/unit/
├── domains/realtime/                            + ADD  flat domain (routes only)
│   ├── realtime.routes.ts                       POST /realtime/ticket
│   │                                            POST /internal/realtime/handshake
│   ├── realtime.controller.ts · .service.ts · .dto.ts · .validator.ts · .container.ts
│   ├── realtime.overview.md
│   └── __tests__/integration/realtime.integration.test.ts   ! validate:domain REQUIRES this
├── tests/unit/realtime/contract-fixtures.unit.test.ts       + ADD  the TS half of §4.5
│
├── routes.ts                                    ~ EDIT  register the plugin
├── domains/domain-containers.plugin.ts          ~ EDIT  wire the container
├── infrastructure/queue/commit-dispatch/*.ts    ~ EDIT  + 'realtime_event' variant + case
├── domains/notify/…/notification-dispatch.service.ts   ~ EDIT  schedule the task
├── shared/config/env-schema.ts                  ~ EDIT  ! new env vars
├── scripts/validators/domain/validate-domain.ts ~ EDIT  ! FLAT_DOMAINS += 'realtime'
└── OVERVIEW.md · PATTERNS.md · FLOWS.md · POLICIES.md   ~ EDIT  ! narratives

package.json          ~ EDIT  dev:socket / build:socket / test:socket passthroughs
docker-compose.yml    ~ EDIT  socket service
.env.example          ~ EDIT  ! sync
CLAUDE.md             ~ EDIT  document the polyglot layout + the socket service
.github/workflows/pr-ci.yml                   ~ EDIT  Go lane + path filter + Quality gate needs
.github/workflows/reusable-railway-deploy.yml ~ EDIT  for service_name in api worker socket
docs/routes.txt + 3 route-catalog JSON files  ~ EDIT  ! regenerate
```

**`assert-connection-budget.ts` is deliberately absent** — the Go service holds no Postgres pool, so
the budget guard is correct as written (§1.2).

**TypeScript gates that fire:** `knip` (`files: error` — land each file with its caller) ·
`tsdoc:check` (budget 0/0; `@remarks` on service files) · `validate:domain` · snake_case body keys ·
`routes:catalog:check`. **None of them look at `socket/`.**

---

## 10 · Build order

| Step | Do | Behind the flag |
|---|---|---|
| 1 | `contract/fixtures/` + the Zod schema + `protocol` package + both fixture tests | n/a — pure |
| 2 | `commit-dispatch` variant + executor + `realtime-publisher.ts` | **Deploy alone first** — the task is persisted to Redis, so every running process must parse it before any is written |
| 3 | `env-schema.ts`, `.env.example`, Go `internal/config` | ✅ |
| 4 | Ticket service + handshake endpoint + the `realtime` domain | ✅ `REALTIME_ENABLED=false` |
| 5 | Go skeleton: `main.go`, health, Makefile, Dockerfile.socket, CI lane | ✅ |
| 6 | `hub`, `conn`, `ingest`, `policy` + shutdown | ✅ |
| 7 | `core-fe` client, router, provider, CSP | ✅ |
| 8 | Notification publisher wired | ✅ |
| 9 | Railway service, load test, metrics, dashboards, narratives | — |

Everything merges inert. Turning it on is a config change, not a deploy.

**Checkpoint to aim for after step 6:** a hand-written `redis-cli XADD core:local:rt:events …`
producing a frame in your browser. That proves stream → ingest → registry → tier → socket with the
notification publisher not yet involved, and every later bug has a much smaller haystack.

**Realistic: 2.5–3.5 weeks** for a first-time Go engineer to a demoable end-to-end path; about half
that if someone already knows Go. Add the load test and SLO work on top.

---

## 11 · `core-fe`

Unchanged from [`realtime-go-service-plan.md`](realtime-go-service-plan.md) §9. The frontend does not
know or care which language terminates the socket. The rule that matters most, restated:

> **The socket is a cache-invalidation signal, not a data channel.** It never writes application data
> into a store — it tells TanStack Query what is stale.

Two specifics: add `realtime-ticket.ts` (`POST /realtime/ticket` before connecting), and list **both**
the `https://` and `wss://` forms of the socket origin in `connect-src` — CSP3 says an `https:`
source should match `wss:` for the same host, but WebKit has been inconsistent, and the failure mode
is a silently blocked connection in Safari only.

---

## 12 · Keeping the exit cheap

Four decisions make it possible to fold the socket back into TypeScript, or split it into its own
repo, without touching domain code:

1. **Version the envelope** (`v: 1`); never let a handler read a Drizzle row directly.
2. **Publish through one function** — `publishRealtimeEvent(envelope)`.
3. **Never write to Postgres from the socket service.** It has no connection; keep it that way.
4. **Keep `tierFor()` pure.** No I/O. It is the one place where a bug is a cross-tenant leak.
