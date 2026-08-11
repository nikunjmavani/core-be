# Realtime (Go) — core-be implementation map

> **Companion to** [`realtime-go-service-plan.md`](realtime-go-service-plan.md), which owns the
> *why*. This document owns the *where*: every file to add, every file to update, the gates that
> will fire, and the order to do it in.
> **Status:** proposal. Nothing here is implemented yet.
> **Scope:** `core-be` only. The Go service lives in its own repo (`core-rt`); `core-fe` has its
> own integration section in the plan.

---

## 0 · How to read this

| Marker | Meaning |
| ------ | ------- |
| **`+ ADD`** | New file. Does not exist today. |
| **`~ EDIT`** | Existing file, needs a change. |
| **`! GATE`** | Existing file that a CI/pre-commit gate will force you to touch. Miss it and the build goes red. |
| **`= KEEP`** | Called out only to say explicitly that it does **not** change. |

Every path below was verified against the tree on `main` at the time of writing. Line references
are indicative — re-grep before editing.

---

## 1 · Two amendments to the plan, found by reading the code

Both of these make the plan **simpler**, and both were only visible from the source. Treat them as
supplanting the corresponding sections of `realtime-go-service-plan.md`.

### 1.1 Durable post-commit publish already exists — do not build a second one

The plan proposed "inline post-commit publish (primary) + notification-worker backstop guarded by
`SETNX`" to survive a Redis blip. That backstop is **redundant**.

`scheduleCommitDispatch()` does not fire-and-forget. Reading
[`commit-dispatch.types.ts`](../../../src/infrastructure/queue/commit-dispatch/commit-dispatch.types.ts):

```ts
export const commitDispatchTaskSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mail_outbox'),      mailOutboxId: …, requestId: … }),
  z.object({ type: z.literal('notification'),     notificationId: …, organizationPublicId: … }),
  z.object({ type: z.literal('user_data_export'), exportPublicId: …, userPublicId: …, … }),
]);
```

The task is **Zod-validated and persisted to Redis before the HTTP response returns**, then
acknowledged after execution, with `commit-dispatch-recovery.worker.ts` replaying anything left
unacknowledged. That is a transactional outbox in all but name — the exact durability property the
`SETNX` backstop was invented to provide.

**Amended design:** add a fourth variant to the union and let the existing machinery carry it.

```ts
z.object({
  type: z.literal('realtime_event'),
  envelope: realtimeEnvelopeSchema,   // bounded; it is persisted to Redis
}),
```

This is strictly better than the plan's version on three counts:

- **One publish path, not two.** No `SETNX` dedupe key, no double-publish window, no second code
  path to reason about during an incident.
- **Any domain can publish.** `scheduleCommitDispatch({ type: 'realtime_event', envelope })` works
  from billing or tenancy without a notification row existing. The plan's design coupled realtime
  delivery to the notification worker.
- **It reuses proven, already-monitored infrastructure** — the recovery worker, its DLQ, and its
  metrics — instead of standing up a parallel mechanism nobody has operated yet.

The one constraint it adds: the envelope is serialized into Redis, so it must stay small and
strictly serializable. Cap it (see `REALTIME_MAX_ENVELOPE_BYTES` in §5.7) and reject oversize
payloads at build time rather than at `XADD` time.

D9 (at-least-once + client dedupe) still holds — the recovery worker can legitimately replay a task
whose execution succeeded but whose acknowledgement was lost.

### 1.2 Do **not** authenticate the internal handshake with an organization API key

The plan said the internal handshake endpoint is "protected by the existing
`api-key-auth.middleware.ts`". Reading that middleware, that is wrong.

`applyApiKeyAuthentication()` resolves an `ak_`-prefixed key to a row carrying `apiKeyPublicId` and
an **owning organization**, then sets tenant context from it. It is a *customer-facing,
organization-scoped* credential.

`core-rt` is not an organization. Binding it to one would mean either minting a key under some
arbitrary tenant (which pollutes that tenant's audit trail and quota, and grants core-rt that
tenant's scope) or inventing a fake org. Both are wrong, and the second is the kind of thing that
looks harmless until it appears in a security review.

**Amended design:** a dedicated shared secret with its own `preHandler`, unrelated to the customer
API-key surface — `REALTIME_INTERNAL_SECRET`, compared in constant time, carried as
`X-Realtime-Secret`, and paired with Railway private networking so the endpoint is not
publicly routable at all. Defence in depth: network isolation *and* a secret, neither alone.

---

## 2 · The tree — what gets added

```text
core-be/
├── src/
│   ├── infrastructure/
│   │   └── realtime/                                     + ADD  ← the transport (§4.1)
│   │       ├── realtime.overview.md                      + ADD  ! GATE  overview-doc convention
│   │       ├── realtime.constants.ts                     + ADD
│   │       ├── realtime-envelope.ts                      + ADD  envelope build + Zod schema
│   │       ├── realtime-shard.util.ts                    + ADD  shardFor(org_id)
│   │       ├── realtime-publisher.ts                     + ADD  XADD to the sharded stream
│   │       ├── realtime-ticket.service.ts                + ADD  mint / redeem (Redis GETDEL)
│   │       └── __tests__/unit/
│   │           ├── realtime-envelope.unit.test.ts        + ADD
│   │           ├── realtime-shard.util.unit.test.ts      + ADD  hash stability is a contract
│   │           ├── realtime-publisher.unit.test.ts       + ADD
│   │           └── realtime-ticket.service.unit.test.ts  + ADD  single-use / TTL
│   │
│   └── domains/
│       └── realtime/                                     + ADD  flat domain (§4.2)
│           ├── realtime.routes.ts                        + ADD
│           ├── realtime.controller.ts                    + ADD
│           ├── realtime.service.ts                       + ADD
│           ├── realtime.dto.ts                           + ADD
│           ├── realtime.validator.ts                     + ADD
│           ├── realtime.serializer.ts                    + ADD
│           ├── realtime.container.ts                     + ADD
│           ├── realtime.overview.md                      + ADD
│           └── __tests__/
│               ├── integration/
│               │   └── realtime.integration.test.ts      + ADD  ! GATE  validate:domain REQUIRES this
│               └── unit/
│                   ├── realtime.validator.unit.test.ts   + ADD
│                   └── realtime.controller.unit.test.ts  + ADD
│
└── src/tests/
    └── security/realtime/
        ├── realtime-ticket.security.test.ts              + ADD  replay / expiry / single-use
        └── realtime-internal-auth.security.test.ts       + ADD  handshake secret required
```

**Why a flat domain and not a sub-domain of `notify`.** The ticket endpoint is not a notification
concern — it mints a transport credential, and later event types (billing, tenancy) have nothing to
do with `notify`. Nesting it under `notify` would make every future publisher import across a
domain boundary for no reason. `realtime` joins `audit` and `upload` as a flat domain: layers at the
domain root, no `sub-domains/`.

**Why the transport is split from the domain.** `src/infrastructure/realtime/` is imported by
*publishers in other domains* (notify today, billing tomorrow). If it lived inside
`src/domains/realtime/`, every publisher would be doing a cross-domain import of another domain's
internals, which the dependency rules forbid. Infrastructure is the correct home for something every
domain calls. The `domains/realtime/` folder owns only the HTTP surface.

---

## 3 · The tree — what gets updated

```text
core-be/
├── src/
│   ├── routes.ts                                          ~ EDIT  register the route plugin
│   ├── OVERVIEW.md · PATTERNS.md · FLOWS.md · POLICIES.md  ~ EDIT  ! GATE  system narratives
│   │
│   ├── infrastructure/queue/commit-dispatch/
│   │   ├── commit-dispatch.types.ts                       ~ EDIT  + 'realtime_event' variant
│   │   └── commit-dispatch.executor.ts                    ~ EDIT  + the matching case
│   │
│   ├── domains/
│   │   ├── domain-containers.plugin.ts                    ~ EDIT  wire registerRealtimeContainer()
│   │   └── notify/sub-domains/notification/
│   │       ├── notification-dispatch.service.ts           ~ EDIT  schedule the realtime task
│   │       └── workers/notification.worker.ts             = KEEP  (see §5.5 — amendment 1.1)
│   │
│   ├── shared/
│   │   ├── config/env-schema.ts                           ~ EDIT  ! GATE  new env vars
│   │   └── locales/en/{errors,success}.json               ~ EDIT  ! GATE  i18n keys
│   │
│   └── scripts/validators/domain/validate-domain.ts       ~ EDIT  ! GATE  FLAT_DOMAINS += 'realtime'
│
├── tooling/openapi/route-catalog/
│   ├── route-success-statuses.json                        ~ EDIT  ! GATE
│   ├── route-org-scope.json                               ~ EDIT  ! GATE
│   └── route-authorization-model.json                     ~ EDIT  ! GATE
│
├── docs/
│   ├── routes.txt                                         ~ EDIT  ! GATE  regenerate, never hand-edit
│   └── README.md                                          ~ EDIT  index the new docs
│
├── .env.example                                           ~ EDIT  ! GATE  env sync
├── CLAUDE.md                                              ~ EDIT  infra tree + domain map
├── docker-compose.yml                                     ~ EDIT  optional local core-rt
└── .github/workflows/reusable-railway-deploy.yml          ~ EDIT  third service
```

---

## 4 · New files — what goes in each

### 4.1 `src/infrastructure/realtime/`

| File | Contents | Notes |
| ---- | -------- | ----- |
| `realtime.constants.ts` | `REALTIME_STREAM_SHARDS = 16`, `REALTIME_STREAM_MAXLEN = 10_000`, `REALTIME_TICKET_TTL_SECONDS = 30`, `REALTIME_MAX_ENVELOPE_BYTES`, stream key prefixes | Constants only — no env reads. Env belongs in `env-schema.ts`; these are policy numbers. |
| `realtime-envelope.ts` | `realtimeEnvelopeSchema` (Zod) + `buildRealtimeEnvelope()` | The Zod schema is the contract, and it is what `commit-dispatch.types.ts` embeds. Generates the ULID. Enforces the byte cap. Splits `summary` / `payload`. |
| `realtime-shard.util.ts` | `shardFor(organizationPublicId): number` | A stable non-cryptographic hash mod `REALTIME_STREAM_SHARDS`. **Its stability is a wire contract** — change the hash or the shard count and in-flight events land on a stream nobody is reading. Pin it with a golden test. |
| `realtime-publisher.ts` | `publishRealtimeEvent(envelope)` → `XADD rt:events:{shard} MAXLEN ~ N` | Fire-and-forget **with a timeout**. Never throws into the caller: log + `recordRealtimePublishFailure()`. The row is already committed; the UI repairs on next refetch. |
| `realtime-ticket.service.ts` | `mintRealtimeTicket()`, `redeemRealtimeTicket()` | 128-bit `randomBytes`. `SETEX` on mint; **`GETDEL` on redeem** so redemption is atomically single-use. Never log the ticket value. |
| `realtime.overview.md` | Module overview per template A.3 | Required by the overview-doc convention — every other `src/infrastructure/*` module has one. |

**Redis key prefix.** Use `redisConnection` from `infrastructure/cache/redis.client.ts`, which
already applies `resolveRedisKeyPrefix()` (`core:<NODE_ENV>:`). Do **not** build a raw client —
`core-rt` must be configured with the same prefix or the two will talk past each other. This is the
single most likely "it works locally, silence in dev" bug in the whole project.

### 4.2 `src/domains/realtime/`

Two routes, following the API contract (snake_case body keys, `POST` → 201, `schema.summary` /
`description` / `tags` present on every registration):

| Route | Auth | Returns |
| ----- | ---- | ------- |
| `POST /api/v1/realtime/ticket` | `app.authenticate` (normal Bearer) | `201 { ticket, expires_in, socket_url }` |
| `POST /api/v1/internal/realtime/handshake` | `realtimeInternalSecretPreHandler` (§1.2) | `201 { user_id, expires_at, active_org_id, memberships[], limits }` |

- **`realtime.service.ts`** — the handshake resolver. Cross-domain **service** imports only:
  `AuthSessionService` (re-verify the bearer through `verifyActiveAccessToken`), `MembershipService`
  (active memberships), `AuthorizationService` (per-org permission sets, already Redis-cached). Never
  import another domain's repository or schema.
- **`realtime.container.ts`** — accepts those cross-domain services as parameters, per the container
  dependency rule.
- **No `realtime.schema.ts` and no repository.** The domain owns no tables. Tickets live in Redis;
  everything else is read through other domains' services.
- **No migration.** Worth stating explicitly: this feature adds **zero** DDL.

---

## 5 · Existing files — what changes and why

### 5.1 `src/routes.ts` — register the plugin

Follows the existing pattern exactly:

```ts
await app.register(realtimeRoutesPlugin, { prefix: `${apiV1}/realtime` });
```

The internal handshake route registers on its own prefix (`${apiV1}/internal/realtime`) so it is
trivially excludable at the edge — the reverse proxy can 404 `/api/v1/internal/*` from the public
listener, which is a much stronger guarantee than a per-route check.

### 5.2 `src/domains/domain-containers.plugin.ts` — wire the container

Add `registerRealtimeContainer()` alongside the existing registrations. It must run **after** the
auth and tenancy containers, since it takes their services as dependencies.

### 5.3 `commit-dispatch.types.ts` — the new task variant

```ts
z.object({
  type: z.literal('realtime_event'),
  envelope: realtimeEnvelopeSchema,
}),
```

Because the union is a **Zod discriminated union persisted to Redis**, this is a wire-format change:
a task written by the new code and replayed by an old instance mid-deploy will fail validation.
Ship the type + executor change **one deploy ahead** of anything that schedules the task, so every
running instance can already parse it. Standard expand/migrate/contract — worth the extra deploy.

### 5.4 `commit-dispatch.executor.ts` — the matching case

```ts
case 'realtime_event':
  await publishRealtimeEvent(task.envelope);
  break;
```

The switch is exhaustive over the union, so TypeScript will point at this file the moment you add
the variant. That is the type system doing the change-completeness work for you.

### 5.5 `notification-dispatch.service.ts` — schedule the realtime task

Inside `createAndDispatchNotification`, after the existing `scheduleCommitDispatch({ type:
'notification', … })`, schedule a second task carrying the envelope.

**Ordering matters and is already correct:** the org lookup runs before the insert (so a failure
leaves no orphan row), the insert commits, and only then is anything scheduled. Keep that shape —
build the envelope from the persisted row's ids, never from the input.

`notification.worker.ts` is marked **`= KEEP`**: per amendment §1.1 the `in_app` backstop is
unnecessary, because commit-dispatch is already durable. Leaving `case 'in_app': results.push(
'in_app:persisted')` untouched is the smaller, more honest change.

### 5.6 `validate-domain.ts` — the gate nobody expects

```ts
const FLAT_DOMAINS = new Set(['audit', 'upload']);   // → add 'realtime'
```

This set is **hardcoded**. A new domain not listed here is treated as multi-resource, and the
validator demands a `sub-domains/` directory it should not have. `pnpm validate:domain` runs on
pre-commit and in `ci:quality`, so this fails fast — but the error message points at your new domain
rather than at this file, which is why it is called out.

### 5.7 `env-schema.ts` — new variables

Each is an `envVar()` entry with `allowed` + `description`, honouring the three env principles:
static production-safe defaults, conditions in the `.refine()` layer, one behaviour per variable.

| Variable | Default | Purpose |
| -------- | ------- | ------- |
| `REALTIME_PUBLISH_ENABLED` | `false` | The kill switch. Static, production-safe default — publishing is opt-in. |
| `REALTIME_INTERNAL_SECRET` | *(none)* | Shared secret for the handshake endpoint (§1.2). Add a `.refine()` making it **required when `REALTIME_PUBLISH_ENABLED` is true** — that condition belongs in the env layer, never in a runtime `if`. |
| `REALTIME_SOCKET_URL` | *(none)* | The `wss://` origin handed to clients in the ticket response. |
| `REALTIME_CROSS_ORG_TITLES` | `false` | D8. Production-safe default: no cross-tenant free text. |

Then `pnpm tool:sync-env-example --fix` and check the generated `.env.example` section by hand —
the tool appends, it does not choose the right section for you.

### 5.8 Route-catalog data files

Adding routes invalidates three checked-in JSON files plus the generated catalog:

```bash
pnpm routes:catalog                  # regenerates docs/routes.txt — never hand-edit it
pnpm validate:route-success-statuses # then add the new routes to route-success-statuses.json
pnpm validate:route-org-scope        # and to route-org-scope.json
pnpm validate:route-schema-docs      # fails unless every registration has summary/description/tags
```

The internal handshake route needs a deliberate decision in
`route-authorization-model.json`: it is neither public nor org-permission-gated. Classify it
explicitly rather than letting the classifier guess.

### 5.9 System narratives and CLAUDE.md

| File | Change |
| ---- | ------ |
| `src/OVERVIEW.md` | Add `realtime` to the domain list and the infrastructure list |
| `src/FLOWS.md` | New flow: write → commit → commit-dispatch → stream → core-rt → browser |
| `src/PATTERNS.md` | The publish-after-commit pattern and the summary/payload tiering rule |
| `src/POLICIES.md` | The new policy constants from `realtime.constants.ts` |
| `CLAUDE.md` | The `src/infrastructure/` tree block and the domain/sub-domain mapping table |

These are not optional politeness. The change-completeness rule is explicit: *"When a single fact
lives in more than one place, grep the literal across `src/`, `docs/`, and `agent-os/` so no mirror
is left stale."* The `docs/git-proxy-branch-claim` branch exists precisely because that rule was
skipped once already.

---

## 6 · The gates that will fire

Ordered by how likely they are to surprise you.

| Gate | Trips when | Fix |
| ---- | ---------- | --- |
| **`pnpm knip`** — `files: "error"` | Any new `.ts` not transitively reachable from an entry root. Writing `realtime-publisher.ts` before anything imports it **fails the build**. | Land each file together with its caller, or in the same PR as the wiring. Do not add a `knip.jsonc` ignore to paper over it. |
| **`pnpm tsdoc:check`** — budget `0 / 0` | Any exported symbol without a TSDoc summary; any export in a **service / worker / processor / policy** file without `@remarks` (Algorithm / Failure modes / Side effects / Notes). | `realtime.service.ts`, `realtime-publisher.ts` and `realtime-ticket.service.ts` all need full `@remarks`. The budget is a ratchet at zero — it can only go down. |
| **`pnpm validate:domain`** | New domain missing `__tests__/integration/*.test.ts`, or absent from `FLAT_DOMAINS` (§5.6). | Add both. |
| **`snake-case-body-keys.policy.unit.test.ts`** | A `*.dto.ts` or `*.serializer.ts` property key in camelCase. | `expires_in`, `socket_url`, `user_id`, `active_org_id`, `expires_at` — all snake_case. Note the envelope in `commit-dispatch` is internal, not a response body, so it is outside this policy; keep it snake_case anyway for one vocabulary across the wire. |
| **`pnpm routes:catalog:check`** | `docs/routes.txt` stale after adding routes. | Regenerate; never hand-edit. |
| **`validate:route-schema-docs`** | A registration missing `schema.summary` / `description` / `tags`. | Both new routes. |
| **`pnpm tool:sync-env-example`** | Schema and `.env.example` diverge. | Run with `--fix`, then place the block in the right section by hand. |
| **i18n message guard** | A raw user-facing string in an error or success payload. | Add keys to `src/shared/locales/en/` first, then `es/`. |
| **SonarQube (pre-commit, no bypass)** | Any open issue on the deployed surface. | Must be cleared — there is no bypass on this one. |

---

## 7 · Build order

Dependency-ordered, each step independently mergeable and green on its own.

| Step | Do | Why here |
| ---- | -- | -------- |
| 1 | `realtime.constants.ts`, `realtime-envelope.ts`, `realtime-shard.util.ts` + unit tests | Pure, no dependencies. The envelope schema is needed by step 2. |
| 2 | `commit-dispatch.types.ts` + `commit-dispatch.executor.ts` + `realtime-publisher.ts` | **Deploy this alone first** (§5.3) so every running instance can parse the new task before any is written. |
| 3 | `env-schema.ts`, `.env.example` | Everything downstream reads these. |
| 4 | `realtime-ticket.service.ts` + the `realtime` domain + `validate-domain.ts` + route catalogs | The HTTP surface. `core-rt` can now handshake against a real endpoint. |
| 5 | `notification-dispatch.service.ts` | The first real publisher. Behind `REALTIME_PUBLISH_ENABLED=false` until `core-rt` is deployed. |
| 6 | Narratives, `CLAUDE.md`, `docker-compose.yml`, deploy workflow | Doc and ops catch-up; no runtime risk. |

Steps 1–5 can all merge with the kill switch off, so `main` carries the full publish path while it
is inert. Turning it on is then a config change, not a deploy — which is what makes the rollout in
the plan (staff → 5% → 25% → 100%) actually reversible.

---

## 8 · What deliberately does not change

Worth stating, because each is a thing someone will otherwise propose in review:

- **No migration, no schema file.** Zero DDL. `notify.notifications` is unchanged — realtime reads
  ids off the already-persisted row.
- **No new BullMQ queue.** Commit-dispatch carries the task (§1.1). Adding a `realtime` queue would
  mean a second durability mechanism doing the same job.
- **No change to `auth.middleware.ts`.** The socket credential is a ticket, not a bearer; the
  handshake re-uses `verifyActiveAccessToken` through a service, not a new middleware path.
- **No change to the RLS model.** `core-rt` never touches Postgres, so there is no context wrapper,
  no GUC, and no `organizationPublicId` job payload to thread.
- **No `X-Organization-Id` involvement.** Active org comes from the signed `org` JWT claim at
  handshake, consistent with the rest of the API contract.
- **`notification.worker.ts` stays as-is** (§5.5).
