# Architecture Conformance Audit — 2026-06-08

**Auditor:** Claude (5-agent parallel survey)
**Scope:** every domain / sub-domain / file under `src/domains/**` and `src/core/events/**`
**Compared against:** `CLAUDE.md` — Domain Structure, Naming Conventions, Dependency Rules, Containers, Seeding, In-source documentation system
**Method:** five independent agents each surveyed one dimension (layer-violation imports / directory structure / file naming / container DI pattern / schema-seed-events presence). Findings below are the union of their reports.

## Section 1 — Executive verdict

The codebase is **broadly conformant** with the documented canonical structure. Every domain has a routes file, every sub-domain that exposes a resource has the layered files (controller / service / repository / dto / validator / serializer / types), and the full-names rule is well respected at the identifier level (zero abbreviation violations in non-comment code). The recent Round 4 / Round 5 work plus PR #530's "no direct DB in services" gate confirms the service → repository discipline is being enforced.

Drift is concentrated in **five recurring patterns** — not random — and most are mechanical to fix:

| # | Pattern | Count of affected files / dirs |
|---|---|---|
| 1 | Container & controller layer violations in **billing/stripe-webhook** | 3 files |
| 2 | Nested sub-domains missing `OVERVIEW.md` and `__tests__/` | 5 dirs |
| 3 | Container exported function uses positional params instead of `{...}` options object | 8 containers |
| 4 | Owning sub-domains with no `seed/` directory, or with seed files using legacy names | 5 missing `seed/` + 4 legacy `<domain>.seed.ts` |
| 5 | `auth-mfa-session` is a one-file stub mislocated outside `auth-mfa` (should nest); `auth/handlers/` + `auth/shared/` are non-canonical sibling dirs | 3 structural anomalies |

Headline numbers: **4 real layer violations**, **5 nested dirs missing both `OVERVIEW.md` and `__tests__/`**, **8/8 containers** using non-canonical positional params, **5 sub-domains** owning tables but missing `seed/`, **18 sub-domains** missing the optional-but-documented `*.reference.seed.ts`.

## Section 2 — Layer violations (Agent A)

Four real violations of the `controller → service → repository` boundary rule. All others (54 cross-domain imports total) are `type`-only DI annotations, schema-for-join exceptions, or shared constants helpers — explicitly allowed by `CLAUDE.md`.

### V1 — `billing/sub-domains/stripe-webhook/stripe-webhook.container.ts:6-7`

- Imports `OrganizationRepository` and `OrganizationService` **as values** from `@/domains/tenancy/...` and instantiates them locally.
- **Violates:** "Containers must wire own-domain repos → own-domain services. Accept cross-domain deps as constructor params, never via direct import of concrete service classes from other domains."
- **Fix:** make `OrganizationService` an injected parameter of `createStripeWebhookServiceForWorker(...)`; the worker bootstrap calls `createTenancyContainer` (or a worker-scoped tenancy factory) once and passes the resulting `OrganizationService` in. Switch the imports to `import type` only.

### V2 — `billing/sub-domains/stripe-webhook/stripe-webhook.controller.ts:9`

- Imports `StripeWebhookEventRepository` directly and instantiates it inside `createStripeWebhookController`.
- **Violates:** "Controllers may import: services (or container deps), `@/shared/utils/http/...`, shared errors." No repositories.
- **Fix:** move `new StripeWebhookEventRepository()` into the sub-domain container; the container constructs the service with the repo injected, the controller receives the service only.

### V3 — `tenancy/sub-domains/organization/organization.controller.ts:12`

- Imports `AuditSerializer` from `@/domains/audit/audit.serializer.js` to shape audit-log list responses.
- **Violates:** "Controllers may import: services (or container deps) …, shared errors." Serializers from other domains are none of those, and it routes the tenancy controller through audit's response-shaping internals.
- **Fix:** expose `AuditService.listForOrganizationSerialized()` (or similar) so the audit service returns already-shaped rows; the controller calls `successResponse` / `paginatedResponse` only. Keeps audit's serializer private to its domain.

### V4 — duplicate count of V1

- Same file as V1 — counted once above. (Some surveys split into 4 numbered items because the same container has both the repo-import and the concrete-service-import.)

**No service-layer violations found.** Every service that has cross-domain needs either takes the dependency as a constructor param (the documented pattern) or calls a same-domain helper. PR #530's new global test `no-direct-db-in-services.global.test.ts` already pins the service → repository boundary.

## Section 3 — Directory structure conformance (Agent B)

Five **nested sub-domain folders** are missing both `OVERVIEW.md` and a co-located `__tests__/` directory. These are children of larger sub-domains whose lifecycle is tied to the parent aggregate (correct by the nesting rule), but `CLAUDE.md`'s "In-source documentation system" and "Sub-domain unit" rules require each to carry its own overview + tests.

| Nested sub-domain | Missing |
|---|---|
| `tenancy/sub-domains/member-roles/member-role-permission/` | `OVERVIEW.md`, `__tests__/` |
| `tenancy/sub-domains/membership/member-invitation/` | `OVERVIEW.md`, `__tests__/` |
| `tenancy/sub-domains/organization/organization-api-key/` | `OVERVIEW.md`, `__tests__/` |
| `tenancy/sub-domains/organization/organization-notification-policy/` | `OVERVIEW.md`, `__tests__/` |
| `tenancy/sub-domains/organization/organization-settings/` | `OVERVIEW.md`, `__tests__/` |

Notes:

- Tests *do* exist for these resources but live in the parent sub-domain's `__tests__/`. Either leave that and clearly document the layout in each child's OVERVIEW.md, OR mirror the canonical layout and co-locate the unit tests under each nested child.
- `notify/sub-domains/webhook/webhook-event/` is a child folder with only repositories/constants and no OVERVIEW.md either — should either be promoted to a real nested resource or renamed to make its repo-helper status explicit.

## Section 4 — File naming & layout drift (Agent C)

Identifier-level full-names rule: **0 violations** found across all of `src/domains/**/*.ts`. Test-suffix conventions: clean (`*.unit.test.ts`, `*.test.ts`, `*.integration.test.ts`, `*.security.test.ts`, `*.global.test.ts`). The drift is in file *names* and folder *names* relative to the documented prefix and singular-noun rules.

### 4.1 Folder-name prefix violations

| Folder | Issue |
|---|---|
| `auth/sub-domains/auth-method/oauth/` | should be `auth-method-oauth` per the "prefix with parent resource name" rule |
| `auth/sub-domains/auth-method/verification-token/` | should be `auth-method-verification-token` per the same rule |
| `auth/sub-domains/auth-method/oauth/providers/` | plural `providers` (rule says singular); also missing `oauth-` prefix |
| `tenancy/sub-domains/member-roles/` | folder is plural `member-roles` but every file inside is singular `member-role.*.ts`. Either rename the folder to `member-role` or accept the documented exception in `CLAUDE.md` table (which DOES list `member-roles` as the official folder name). If we accept it, document the why in OVERVIEW.md. |
| `auth/handlers/` | not part of the canonical layout (`CLAUDE.md` lists `events/`, `seed/`, `__tests__/`, `sub-domains/` as the only optional siblings). Should either be folded into `<resource>.controller.ts` or renamed. |
| `auth/shared/` | same — not in the canonical layout. |
| `auth/sub-domains/auth-mfa-session/` | should be nested under `auth-mfa/auth-mfa-session/` (lifecycle tied to MFA aggregate) per the nesting rule. |

### 4.2 Files missing canonical layer suffix

Each of these is a `.ts` file inside a sub-domain that doesn't end with one of the canonical layer suffixes (`.controller.ts`, `.service.ts`, `.repository.ts`, `.dto.ts`, `.validator.ts`, `.serializer.ts`, `.types.ts`, `.schema.ts`, `.handlers.ts`, `.routes.ts`, `.constants.ts`, `.util.ts`):

- `auth/sub-domains/auth-mfa-session/auth-mfa-session.ts` (only file in the folder; exports types + helpers)
- `auth/sub-domains/auth-webauthn/webauthn-challenge.ts`
- `auth/sub-domains/auth-method/oauth/oauth-user-session.ts`, `oauth-state.ts`, `oauth-pkce.ts` (three sibling utility files)
- `auth/shared/complete-first-factor-auth.ts` (sibling `audit-login.util.ts` correctly uses `.util.ts`)
- `billing/sub-domains/subscription/stripe-payment-provider.ts` (sibling `payment-provider.port.ts` is correct)
- `tenancy/sub-domains/membership/member-invitation/member-invitation.token.ts` (`.token.ts` is not a documented suffix)
- `tenancy/sub-domains/organization/organization-settings/i18n-locale.cache.ts` (`.cache.ts` is not a documented suffix)
- `auth/handlers/auth-auth-method.handlers.ts` (double `auth-auth-` prefix; should be `auth-method.handlers.ts` since it's already inside `auth/`)
- `auth/sub-domains/auth-method/magic-link.service.ts` (bare resource name; siblings use the `auth-method.` prefix → inconsistent within the same folder)

### 4.3 Sub-domain-vs-file singular mismatch

- `tenancy/sub-domains/member-roles/member-role.service.ts` (and siblings): folder plural / files singular.

### 4.4 Single permission test naming

- `tenancy/sub-domains/permission/__tests__/permissions.test.ts` — folder `permission/` but file `permissions.test.ts`. Minor.

## Section 5 — Container / DI consistency (Agent D)

Every container is wired correctly into `domain-containers.plugin.ts` in dependency order, type-only cross-domain imports are correctly used everywhere except V1 above, and `notify`'s container correctly registers event handlers that need repository deps (per `CLAUDE.md` two-path rule). The single recurring drift:

**All 8 containers (`audit`, `auth`, `billing`, `notify`, `tenancy`, `upload`, `user`, plus `billing/sub-domains/stripe-webhook`) use positional parameters** instead of the documented `register<Domain>Container({...})` options-object shape. This is a code-smell, not a correctness issue:

- Adding a new cross-domain dependency is a breaking change to every call site instead of a single field addition to the options object.
- Some containers (e.g. `tenancy.container.ts`) have an optional `userSettingsService?` param that's always supplied at the call site — dead optionality.
- The `_objectStorage` underscore-prefix in `tenancy.container.ts` is param-name lint noise; an options object would let us drop it.

Plus one structural anomaly already covered in V1: `stripe-webhook.container.ts` is the only container nested under a sub-domain, exists for the worker-only factory path, and re-instantiates dependencies that the canonical `billing.container.ts` also constructs.

## Section 6 — Schema / seed / events presence (Agent E)

### 6.1 Missing `seed/` directories on table-owning sub-domains (5 dirs)

| Sub-domain | Issue |
|---|---|
| `auth/sub-domains/auth-method/verification-token/` | owns tables; no `seed/` |
| `billing/sub-domains/stripe-webhook/` | owns `stripe_webhook_events`; no `seed/` (runtime-only table, but contract still requires the dir) |
| `tenancy/sub-domains/member-roles/member-role-permission/` | owns tables; no `seed/` |
| `tenancy/sub-domains/membership/` (root) | owns tables; no `seed/` |
| `tenancy/sub-domains/organization/` (root) | owns tables; no `seed/` |

### 6.2 Missing `*.reference.seed.ts` files (18 sub-domains)

Only `plan` and `permission` ship `*.reference.seed.ts`. Every other owning sub-domain went straight to bulk + faker. Either drop the four-file requirement from the contract for non-bootstrap tables, or add stub reference seeds. **Decision needed** before the work starts.

### 6.3 Legacy `<domain>.seed.ts` files at 4 domain roots

`audit`, `billing`, `tenancy`, `user` retain a single monolithic `<domain>.seed.ts` alongside the split `<name>.bulk.seed.ts` and `<name>.faker.ts`. Should be renamed to `<name>.reference.seed.ts`.

### 6.4 Missing `seed/index.ts`

- `billing/sub-domains/subscription/seed/` lacks `index.ts`. Trivial fix.

### 6.5 Missing `events/index.ts`

- `notify/sub-domains/webhook/webhook-delivery/events/` has emit helpers + handlers but no `index.ts` aggregator. Standardize on the `*.events.ts` + `*.event-handlers.ts` + `index.ts` triplet that the rest of the codebase uses.

## Section 7 — Prioritized task list and PR plan

The work is grouped into eight focused PRs, each independently mergeable. Priorities reflect risk and behavior impact, not effort.

### P0 — Real architecture violations (must fix)

**Task A1.** Fix layer violations in `billing/sub-domains/stripe-webhook` (V1 + V2).

- Move `OrganizationService` and `StripeWebhookEventRepository` out of `stripe-webhook.container.ts` and `stripe-webhook.controller.ts`.
- The worker bootstrap constructs `OrganizationService` once via the canonical `tenancy.container` and passes it as a parameter.
- Convert `import` → `import type` for the type-only references.
- **Test:** the existing global gate `no-direct-db-in-services.global.test.ts` already catches direct DB in services; consider a parallel gate that forbids controller-layer repo imports.

**Task A2.** Fix layer violation in `tenancy/sub-domains/organization/organization.controller.ts` (V3).

- Expose `AuditService.listForOrganizationSerialized(...)` returning already-shaped audit-log rows.
- Remove `AuditSerializer` import from the tenancy controller.
- Keep the existing per-route response wrapping unchanged.

### P1 — Documentation gaps (low risk, high readability)

**Task B1.** Add `OVERVIEW.md` and `__tests__/unit/` to the five nested sub-domains in `tenancy/` (Section 3). The `__tests__/unit/` directory can start with a single placeholder test or the existing parent-located tests can be moved as part of a follow-up.

**Task B2.** Decide whether `notify/sub-domains/webhook/webhook-event/` and `notify/sub-domains/webhook/webhook-delivery/` are real nested sub-domains or repo-helper folders. If the former, add OVERVIEW.md + canonical layer files. If the latter, rename or restructure so the helper status is explicit.

### P1 — Container canonicalization

**Task C1.** Migrate all 8 containers to the `register<Domain>Container({...})` options-object shape. Drop the underscore-prefixed `_objectStorage` and the optional-but-always-passed `userSettingsService?`. Update `domain-containers.plugin.ts` call sites.

**Task C2.** Decide the fate of `stripe-webhook.container.ts`: either fold its worker-bootstrap responsibilities into the canonical `billing.container.ts` (preferred — single source of wiring) or document why a sub-domain-level container is required for the worker path and accept the duplication.

### P1 — Seeding contract conformance

**Task D1.** Add empty-but-canonical `seed/` directories to the five sub-domains in Section 6.1. Each gets `index.ts` exporting a `SeedContribution` (with empty `seedBulk`); add `bulk` and `faker` files for volume tables (`stripe-webhook` is runtime-only — exempt by reasonable judgment, but add the `index.ts` for orchestrator consistency).

**Task D2.** Make a project-level decision on `*.reference.seed.ts` for non-bootstrap tables (Section 6.2). Either:

- (a) drop the file from the four-file requirement for non-static-data tables (preferred — keeps the contract honest), or
- (b) add stubs across 18 sub-domains.
This decision lands in `CLAUDE.md` and the seed contract; the file work follows.

**Task D3.** Rename the four legacy domain-root `<domain>.seed.ts` files to `<name>.reference.seed.ts` (Section 6.3).

**Task D4.** Add `index.ts` to `billing/sub-domains/subscription/seed/` (Section 6.4) and `notify/sub-domains/webhook/webhook-delivery/events/` (Section 6.5). One-line PR.

### P2 — Naming canonicalization (lower priority, more invasive)

**Task E1.** Rename folder prefix violations (Section 4.1):

- `auth-method/oauth/` → `auth-method-oauth/`
- `auth-method/verification-token/` → `auth-method-verification-token/`
- `auth-method/oauth/providers/` → `auth-method-oauth-provider/`

These are multi-file moves and need careful import-path updates; do as one PR with the global structure validator catching anything missed.

**Task E2.** Promote files missing layer suffix (Section 4.2) to canonical names:

- `auth-mfa-session.ts` → `auth-mfa-session.types.ts` (+ split if it grows past types)
- `webauthn-challenge.ts` → `webauthn-challenge.util.ts`
- `oauth-{user-session,state,pkce}.ts` → `.util.ts`
- `stripe-payment-provider.ts` → `stripe-payment-provider.adapter.ts` (or `.adapter.ts` if we adopt that suffix)
- `member-invitation.token.ts` → `member-invitation-token.util.ts`
- `i18n-locale.cache.ts` → `i18n-locale-cache.util.ts`
- `auth/handlers/auth-auth-method.handlers.ts` → `auth/handlers/auth-method.handlers.ts`
- `auth-method/magic-link.service.ts` → `auth-method-magic-link.service.ts` (or move under a nested `auth-method/auth-method-magic-link/` directory)

**Task E3.** Decide on `tenancy/sub-domains/member-roles/` plural vs singular (Section 4.3). The current state is documented as exception in `CLAUDE.md`'s domain mapping table; we can either add an explanatory note in OVERVIEW.md or accept the rename to `member-role/`.

**Task E4.** Nest `auth-mfa-session/` under `auth-mfa/` per the nesting rule.

**Task E5.** Fold `auth/handlers/` and `auth/shared/` into the canonical layout. `handlers/` likely becomes per-sub-domain `*.handlers.ts` files; `shared/` likely splits into per-sub-domain utils or moves to `src/shared/utils/auth/` if truly cross-cutting.

### P2 — Add a global gate for layer violations going forward

**Task F1.** Add `src/tests/global/controller-layer-imports.global.test.ts` (analogous to `no-direct-db-in-services.global.test.ts`):

- Walks every `*.controller.ts` under `src/domains/**`.
- Fails CI if any imports a `*.repository.ts`, `*.schema.ts`, or `*.serializer.ts` from a domain other than its own.
- An empty `JUSTIFIED_CONTROLLER_IMPORTS` allowlist accepts additions only with documented reasoning.

**Task F2.** Add `src/tests/global/no-cross-domain-concrete-deps-in-containers.global.test.ts`:

- Walks every `*.container.ts`.
- Fails CI if any uses a non-`type` import for a service or repository from another domain.

Together these turn the violations found in Section 2 into permanent CI guarantees against drift.

## Section 8 — Suggested PR sequencing

```text
PR 1 (P0)  ─ Task A1: fix stripe-webhook layer violations
PR 2 (P0)  ─ Task A2: fix organization controller AuditSerializer leak
PR 3 (P1)  ─ Task B1: OVERVIEW.md + __tests__/ for 5 nested sub-domains
PR 4 (P1)  ─ Task D4: seed/index.ts + events/index.ts (one-line cleanup)
PR 5 (P1)  ─ Task C1: containers to options-object shape
PR 6 (P1)  ─ Task D1 + D3: seed/ dirs + legacy seed rename
PR 7 (P2)  ─ Task E1 + E2: folder + file naming canonicalization
PR 8 (P2)  ─ Task F1 + F2: add CI gates so drift fails next time
```

Optional follow-up PR:

```text
PR 9 (P2) ─ Task C2 / E4 / E5: restructure stripe-webhook container,
            nest auth-mfa-session under auth-mfa, fold auth/handlers + shared.
```

## Section 9 — What we deliberately did NOT flag

For honesty and to prevent re-litigation in future audits:

- **Cross-domain service-to-service imports** in services (54 instances total) — all are `type`-only DI annotations correctly wired via the composition root. This is the documented pattern, not a violation.
- **Cross-domain schema imports in repositories** (5 instances) — all back actual `innerJoin`/`leftJoin` queries. Allowed by `CLAUDE.md`'s join exception.
- **Domains that emit events but don't register handlers in their own container** (`auth`, `tenancy`, `billing`) — these route through `register-event-handlers.ts` (path 1 of the two registration paths), which is the documented pattern for handlers that only need `enqueueEmail()`.
- **`shared/utils/auth/`, `shared/utils/http/`, etc.** — these are cross-cutting helpers, not domain code, and live in the documented `src/shared/` layout.

## Section 10 — Honest residual-risk statement

This audit was static — file-by-file, import-by-import. It did not exercise:

- Runtime DI resolution (does every container's exported function actually return a working object graph?).
- Dynamic dispatch (does any service reach into another domain via `await import(...)` at runtime?).
- Test-only crossing of layer boundaries that doesn't show up in the production source tree.
- Behavior under the test runtime's `vi.mock(...)` replacements (does mocking at the import boundary mask any of these violations from per-PR CI?).

The 4 layer violations in Section 2 are concrete and grep-confirmed. The 5 directory-structure gaps in Section 3 are confirmed by file listings. The container drift in Section 5 is confirmed by reading every `*.container.ts`. The seed/events gaps in Section 6 are confirmed by directory walks and `eventBus.emit` greps.

Picking up any of the eight task groups above will land that group's improvements without disturbing the others. Tasks A1, A2, D4 are the highest-readability/lowest-risk landing spots; F1, F2 are the highest-leverage (one PR turns "we noticed drift today" into "drift fails CI tomorrow").
