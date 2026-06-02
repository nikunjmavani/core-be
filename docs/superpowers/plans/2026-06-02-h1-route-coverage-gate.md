# H1 — Wire the Route-HTTP-Coverage Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the already-built `validate-route-http-coverage` validator into a `pnpm` script that runs **blocking** in PR CI, and make it pass honestly by detecting mcp's existing 403 coverage, exempting ops from Tier-E (its only mutating input is a path param whose invalid value is correctly a 404, not a 422), and adding an ops route-smoke test for Tier-C/A.

**Architecture:** The validator (`src/scripts/validators/routes/validate-route-http-coverage.ts`) already `process.exit(1)`s on failure. Tier-C route-literal + mutating-method checks scan **all** of `src/` (global); Tier-D (403) and Tier-E (400/422) scan only `src/domains/<domain>/`. mcp and ops are infrastructure-served (no `src/domains/<domain>/`), so their real coverage isn't seen by the domain-scoped tiers. We (a) map mcp's real 403 test into the domain scan, (b) exempt ops from Tier-E, and (c) add an `ops` route-smoke test (Tier A → satisfies Tier C for the whole domain, including the `:circuitName` param route).

**Tech Stack:** TypeScript, tsx, Vitest, Fastify `inject`, GitHub Actions.

---

## Pre-flight

- [ ] **Step 0: Branch off latest dev**

```bash
cd /Users/nikunjmavani/projects/core/core-be
git checkout dev && git pull origin dev
git checkout -b feat/h1-route-http-coverage-gate
```

- [ ] **Step 0b: Confirm the validator currently FAILS (mcp + ops gaps)**

Run: `pnpm exec tsx src/scripts/validators/routes/validate-route-http-coverage.ts; echo "exit=$?"`
Expected: prints "validate-route-http-coverage failed:" with Tier D (mcp), Tier E (ops), Tier C (ops circuit-breakers, POST /mcp) and `exit=1`.

---

## Task 1: Add the `validate:route-http-coverage` script

**Files:**

- Modify: `package.json` (scripts block, near `validate:test-naming`)

- [ ] **Step 1: Add the script**

In `package.json` `"scripts"`, immediately after the `"validate:test-naming"` line, add:

```json
    "validate:route-http-coverage": "tsx src/scripts/validators/routes/validate-route-http-coverage.ts",
```

- [ ] **Step 2: Verify it runs and still fails (gaps not yet closed)**

Run: `pnpm validate:route-http-coverage; echo "exit=$?"`
Expected: same failure output as Step 0b, `exit=1`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(ci): add validate:route-http-coverage script"
```

---

## Task 2: Teach the validator to see mcp's real 403 coverage

mcp's 403 is genuinely tested in `src/tests/security/auth/mcp-auth.security.test.ts` (asserts 401 no-token, **403 non-admin**, admin-ok). The domain scan can't see it because mcp has no `src/domains/mcp/`. Map the real file into the domain scan.

**Files:**

- Modify: `src/scripts/validators/routes/route-http-coverage-validation.util.ts`
- Test: `src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts`

- [ ] **Step 1: Write the failing unit test**

In `src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts`, add:

```typescript
  it('detects mcp 403 coverage from its real infrastructure test location', () => {
    expect(domainHasForbiddenStatusCoverage('mcp')).toBe(true);
  });
```

Ensure `domainHasForbiddenStatusCoverage` is imported at the top of the test file (add it to the existing import from `route-http-coverage-validation.util.js` if absent).

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm exec vitest run src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts -t "detects mcp 403"`
Expected: FAIL (`expected false to be true`) — the domain scan finds no `src/domains/mcp/`.

- [ ] **Step 3: Add the infrastructure-domain test-file map + use it in the scan**

In `route-http-coverage-validation.util.ts`, add near the other exported constants (after `CATALOG_DOMAIN_TO_FOLDER`):

```typescript
/**
 * Catalog domains served from `src/infrastructure` / `src/shared` rather than a
 * `src/domains/<domain>/` folder. Their HTTP coverage lives in cross-cutting test
 * locations, so the domain-scoped Tier-D/Tier-E scans must also read these files.
 */
export const INFRASTRUCTURE_DOMAIN_TEST_FILES: Record<string, string[]> = {
  mcp: ['src/tests/security/auth/mcp-auth.security.test.ts'],
};
```

Then change `collectDomainHttpSources` to append those files:

```typescript
export function collectDomainHttpSources(catalogDomain: string): string {
  const folder = resolveDomainFolder(catalogDomain);
  const sources: string[] = [];
  collectHttpTestSources(join(DOMAINS_DIR, folder), sources);
  for (const relativePath of INFRASTRUCTURE_DOMAIN_TEST_FILES[catalogDomain] ?? []) {
    const fullPath = resolve(process.cwd(), relativePath);
    if (existsSync(fullPath)) sources.push(readFileSync(fullPath, 'utf-8'));
  }
  return sources.join('\n');
}
```

Confirm `resolve`, `existsSync`, `readFileSync` are already imported at the top of the util (they are, via `node:fs` and `node:path`).

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm exec vitest run src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts -t "detects mcp 403"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/validators/routes/route-http-coverage-validation.util.ts src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts
git commit -m "feat(ci): detect infra-domain (mcp) 403 coverage in route validator"
```

---

## Task 3: Exempt ops from Tier-E (validation 400/422)

The only ops mutating route is `POST /internal/ops/circuit-breakers/:circuitName/reset`. It has **no request body**; an invalid `:circuitName` throws `NotFoundError` (**404**), which is the correct semantic — not a body-validation 422. Exempt ops, mirroring the existing `health`/`mcp` exemption.

**Files:**

- Modify: `src/scripts/validators/routes/route-http-coverage-validation.util.ts`
- Test: `src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts`

- [ ] **Step 1: Write the failing unit test**

Add:

```typescript
  it('exempts ops from Tier-E validation (param-not-found is a 404, not a body 422)', () => {
    expect(DOMAINS_EXEMPT_FROM_VALIDATION_STATUS.has('ops')).toBe(true);
  });
```

Ensure `DOMAINS_EXEMPT_FROM_VALIDATION_STATUS` is imported in the test.

- [ ] **Step 2: Run it — expect FAIL**

Run: `pnpm exec vitest run src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts -t "exempts ops"`
Expected: FAIL (`expected false to be true`).

- [ ] **Step 3: Add ops to the exemption set with a justifying comment**

Change the line in `route-http-coverage-validation.util.ts`:

```typescript
/**
 * Domains with no mutating-route body-validation matrix requirement.
 * - health: liveness/readiness probes carry no body.
 * - mcp: JSON-RPC proxy; auth/role is the gate, not body shape.
 * - ops: the only mutating route's sole input is a path param whose invalid value
 *   is correctly a 404 (NotFoundError), never a body-validation 422.
 */
export const DOMAINS_EXEMPT_FROM_VALIDATION_STATUS = new Set(['health', 'mcp', 'ops']);
```

- [ ] **Step 4: Run the test — expect PASS**

Run: `pnpm exec vitest run src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts -t "exempts ops"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/validators/routes/route-http-coverage-validation.util.ts src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts
git commit -m "feat(ci): exempt ops from Tier-E (path-param 404, not body 422)"
```

---

## Task 4: Add the ops route-smoke test (Tier A → satisfies Tier C)

A real test value (`/stripe/reset`) can't match the catalog literal (`:circuitName`), so use the validator-intended Tier-A mechanism: `loadRoutesForDomain('ops')` adds `ops` to domain-smoke coverage, which skips Tier-C for **all** ops routes. Mirror the existing `notify-route-smoke.integration.test.ts`. Place it under `src/tests/integration/` (global scan sees the `loadRoutesForDomain('ops')` literal).

**Files:**

- Create: `src/tests/integration/ops-route-smoke.integration.test.ts`

- [ ] **Step 1: Write the test**

```typescript
import { describe, it, beforeAll, afterAll } from 'vitest';
import { createTestApp } from '@/tests/helpers/test-app.js';
import {
  loadRoutesForDomain,
  buildRouteSmokeCases,
  assertRouteSmokeUnauthenticated,
} from '@/tests/helpers/route-http-coverage.helper.js';
import type { FastifyInstance } from 'fastify';

// Infrastructure-served internal ops routes (Bearer METRICS_SCRAPE_TOKEN). The
// catalog domain is `ops`; this smoke suite proves every ops route exists and
// rejects an unauthenticated caller, satisfying the route-HTTP-coverage gate.
const opsRoutes = loadRoutesForDomain('ops');

describe('Ops route smoke (catalog)', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const testApp = await createTestApp();
    app = testApp.app;
  });

  afterAll(async () => {
    await app.close();
  });

  for (const route of opsRoutes) {
    it(`${route.method} ${route.path} rejects unauthenticated`, async () => {
      const smokeCase = buildRouteSmokeCases(route);
      await assertRouteSmokeUnauthenticated(app, smokeCase);
    });
  }
});
```

- [ ] **Step 2: Run it — expect PASS**

Run: `pnpm exec vitest run --project integration src/tests/integration/ops-route-smoke.integration.test.ts`
Expected: PASS (2 cases — GET + POST ops routes reject unauthenticated with 401).

> If `buildRouteSmokeCases` requires an organization id arg (check its signature in `src/tests/helpers/route-http-coverage.helper.ts`), pass `undefined` — ops routes are not org-scoped. If `assertRouteSmokeUnauthenticated` asserts a specific status set, confirm it accepts 401; ops returns 401 without a Bearer token via `requireOpsBearerToken`.

- [ ] **Step 3: Commit**

```bash
git add src/tests/integration/ops-route-smoke.integration.test.ts
git commit -m "test(ops): add catalog route-smoke for internal ops circuit-breaker routes"
```

---

## Task 5: Resolve the mcp `POST /mcp` mutating-method flag

The catalog lists mcp twice: `/api/v1/mcp` (allowlisted) and the bare `/mcp` (not allowlisted) — the latter trips the Tier-C mutating-method check. Add the bare path to the allowlist with the same rationale as the versioned one (mcp is a JSON-RPC proxy whose auth/role gate is covered by `mcp-auth.security.test.ts`).

**Files:**

- Modify: `src/scripts/validators/routes/route-http-coverage.allowlist.ts`

- [ ] **Step 1: Add the bare-path allowlist entries**

Append to the array:

```typescript
  // mcp is a JSON-RPC proxy; its auth/role gate is covered by
  // src/tests/security/auth/mcp-auth.security.test.ts. Allowlist both the
  // versioned and bare catalog forms from the route-literal/method check.
  { method: 'GET', path: '/mcp' },
  { method: 'POST', path: '/mcp' },
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/validators/routes/route-http-coverage.allowlist.ts
git commit -m "chore(ci): allowlist bare /mcp catalog form (covered by mcp-auth security test)"
```

---

## Task 6: Validator passes end-to-end

- [ ] **Step 1: Run the full validator — expect PASS**

Run: `pnpm validate:route-http-coverage; echo "exit=$?"`
Expected: `✅ validate-route-http-coverage passed (131 routes; tiers B–E including 403/400 gates)` and `exit=0`.

> If any Tier still fails, read the printed Tier letter + domain and fix the corresponding Task (D→mcp map, E→exemption, C→ops smoke / allowlist) before continuing. Do not weaken a real gate to pass.

- [ ] **Step 2: Run the validator's own unit test + typecheck + lint**

Run: `pnpm exec vitest run src/scripts/validators/__tests__/route-http-coverage-validation.unit.test.ts && pnpm typecheck && pnpm exec biome check src/scripts/validators/routes src/tests/integration/ops-route-smoke.integration.test.ts`
Expected: all PASS / no lint errors.

---

## Task 7: Wire the gate into CI (blocking)

**Files:**

- Modify: `.github/workflows/pr-ci.yml` (the `Static sync` job, near the other `validate:*` run steps ~line 105-111)
- Modify: `package.json` (`ci:quality` and `ci:local` composite scripts)

- [ ] **Step 1: Add a run-step to the Static sync job**

In `.github/workflows/pr-ci.yml`, inside the `Static sync` job's steps, after the existing `run: pnpm validate:scripts-layout` step, add:

```yaml
      - name: Validate route HTTP coverage
        run: pnpm validate:route-http-coverage
```

(Match the surrounding step indentation/format exactly.)

- [ ] **Step 2: Add to `ci:quality` and `ci:local`**

In `package.json`, in the `"ci:quality"` value, insert `&& pnpm validate:route-http-coverage` immediately after `pnpm validate:test-naming`. Do the same in `"ci:local"`.

- [ ] **Step 3: Verify the composite scripts still parse**

Run: `pnpm run | grep -E "ci:quality|ci:local|route-http-coverage"`
Expected: the scripts list shows the new script and the updated composites (no error).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pr-ci.yml package.json
git commit -m "ci: gate PRs on validate:route-http-coverage (blocking)"
```

---

## Task 8: Full local gate + ship

- [ ] **Step 1: Run the relevant gates locally**

Run: `pnpm validate:route-http-coverage && pnpm test:unit -t "route-http-coverage" && pnpm exec vitest run --project integration src/tests/integration/ops-route-smoke.integration.test.ts`
Expected: validator PASS; unit PASS; ops smoke PASS.

- [ ] **Step 2: Push + open PR (pre-commit/pre-push gates run automatically)**

```bash
git push -u origin feat/h1-route-http-coverage-gate
gh pr create --base dev --title "feat(ci): wire route-HTTP-coverage gate + close mcp/ops detection gaps (H1)" --body "First workstream of the exhaustive-hardening roadmap (docs/superpowers/specs/2026-06-02-exhaustive-hardening-design.md). Wires the existing validator into a pnpm script + blocking pr-ci Static-sync step + ci:quality/ci:local. Closes the only real gaps: detects mcp's existing 403 coverage in its infra test location; exempts ops from Tier-E (param-not-found is a 404, not a body 422); adds an ops route-smoke test; allowlists the bare /mcp catalog form. Validator now green (131 routes, tiers B–E)."
```

- [ ] **Step 3: Poll CI; auto-merge on green**

```bash
gh pr checks <PR#> --watch
gh pr merge <PR#> --squash --delete-branch
```

Expected: all checks pass (including the new **Validate route HTTP coverage** step); PR merged to dev.

---

## Self-Review (run before execution)

- **Spec coverage:** H1 spec acceptance = "`pnpm validate:route-http-coverage` exits 0; CI fails if a new route lacks HTTP signal / a guarded domain lacks 403 / a mutating domain lacks 400/422." → Tasks 1+6 (script + green), Task 7 (blocking CI), Tasks 2-5 (close the real gaps honestly). ✅
- **Placeholders:** none — every code change and command is concrete.
- **Type consistency:** `INFRASTRUCTURE_DOMAIN_TEST_FILES`, `collectDomainHttpSources`, `DOMAINS_EXEMPT_FROM_VALIDATION_STATUS`, `loadRoutesForDomain`/`buildRouteSmokeCases`/`assertRouteSmokeUnauthenticated` names match the actual util/helper exports verified in the codebase.
- **Honesty:** no gate is weakened to pass — mcp 403 is real (detected), ops Tier-E exemption is semantically correct (404 not 422), ops Tier-C is a real smoke test, /mcp allowlist points at the real security test.
