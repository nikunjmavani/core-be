---
name: tsdoc-export-guard
description: Ensures every public TypeScript export under src/ has a TSDoc summary, and every public export in service/worker/processor/policy files has an additional @remarks block (Algorithm / Failure modes / Side effects / Notes). Use when adding or renaming exported symbols, when MISSING_DESCRIPTION or MISSING_REMARKS tokens regress, or when authoring a policy constant.
---

# TSDoc export guard

Owns symbol-level documentation: the TSDoc comment that sits immediately above every public `export <kind> <name>` declaration. The generator pairs the comment with the declaration and surfaces missing pieces as `MISSING_DESCRIPTION` / `MISSING_REMARKS` tokens.

## When to run

Run this skill when:

- You add or rename an exported symbol under `src/`.
- The strict feature-doc check reports a `MISSING_DESCRIPTION` regression.
- The strict feature-doc check reports a `MISSING_REMARKS` regression on a service-like or policy-like file.
- You add a new policy constant under `src/shared/constants/`.

## What "service-like" and "policy-like" mean

The validator at [`tooling/feature-docs/file-classifier.ts`](../../../tooling/feature-docs/file-classifier.ts) decides which files require `@remarks` blocks:

- **Service-like**: matches `\.(service|worker|processor)\.ts$`. Every public export needs `summary` **plus** `@remarks`.
- **Policy-like**: matches `\.policy\.ts$`. Every public export needs `summary` **plus** `@remarks`.
- **Everything else**: every public export needs `summary` only.

Additionally, **policy constants** under `src/shared/constants/` (TTLs, limits, security thresholds, billing windows) require `@remarks` even though their files don't end in `.policy.ts`. The convention is enforced by review (and surfaced in `src/POLICIES.md`); the validator does not detect these automatically today.

## Required content

### Summary (every public export)

A 1-3 sentence description, written in present tense ("Persists an audit log row...", not "This function persists an audit log row..."). Use TSDoc inline links (`{@link Name}`) when referencing other exports.

```ts
/**
 * Resolves "is user X allowed to perform permission P in organization O?"
 * — backed by a Redis cache for read performance.
 */
export class AuthorizationService { ... }
```

### `@remarks` (service-like and policy-like exports)

A structured block with the following sub-sections (use plain text headings, not extra `@` tags):

```ts
/**
 * <one-line summary>
 *
 * @remarks
 * Algorithm:
 * 1. Step-by-step description of what the function does.
 * 2. Reference {@link OtherService.method} when the algorithm crosses files.
 *
 * Failure modes:
 * - <error class> → <HTTP status / observable behavior>.
 * - <another failure path>.
 *
 * Side effects:
 * - <DB writes>: which tables, which transactions.
 * - <event emissions>: event type and consumer.
 * - <cache invalidations>: which Redis keys.
 *
 * Notes:
 * - <invariant or trade-off worth knowing>.
 */
```

Real example from [`src/domains/auth/sub-domains/auth-method/magic-link.service.ts`](../../../src/domains/auth/sub-domains/auth-method/magic-link.service.ts):

```ts
/**
 * Issues and verifies one-shot magic-link tokens used by the signup and
 * password-less login flows.
 *
 * @remarks
 * Algorithm:
 * - {@link MagicLinkService.send} validates the email, blocks disposable
 *   domains, looks up the user. If the user does not exist the response is
 *   a silent success (anti-enumeration). Otherwise it generates a 32-byte
 *   random token, persists `sha256(token)` with a 15-min expiry, and emits
 *   `AUTH_EVENT.MAGIC_LINK_REQUESTED` with the raw token in the payload.
 * - {@link MagicLinkService.verify} hashes the incoming token, atomically
 *   consumes the verification row, signs a short-lived JWT, and inserts a
 *   session row.
 *
 * Failure modes:
 * - Disposable email → 400 errors:disposableEmail from `send`.
 * - Unknown email → silent success from `send`.
 * - Token expired or already consumed → 401 errors:invalidOrExpiredMagicLink.
 *
 * Side effects:
 * - `send` emits a domain event whose handler enqueues an outbound email.
 * - `verify` writes a single auth_sessions row.
 *
 * Notes: raw tokens never flow back to HTTP callers.
 */
```

### Policy-constant `@remarks`

Required structure (mirrors `src/POLICIES.md` rows):

```ts
/**
 * <one-line summary describing what the constant controls>
 *
 * @remarks
 * Rationale: <why this number was picked>.
 *
 * Consequences of change:
 * - Decreasing → <what breaks or tightens>.
 * - Increasing → <what relaxes or what risk grows>.
 *
 * Last reviewed: YYYY-MM-DD.
 */
export const MAGIC_LINK_EXPIRES_IN_MINUTES = 15;
```

Cross-link from `src/POLICIES.md`. The skill **system-narrative-maintainer** owns the `src/POLICIES.md` row and cross-pings this skill when a constant is added.

## TSDoc tags

Use:

- `@remarks` — required on service-like / policy-like / policy-constant exports.
- `{@link Name}` — inline cross-reference. Resolves to other TSDoc-extracted symbols. Avoid raw markdown links inside TSDoc.
- `@public` — explicitly marks an export public when the default detection might infer otherwise.
- `@internal` — explicitly marks an export internal so the renderer skips it. Useful for re-exports of internal helpers.
- `@deprecated <reason>` — flag a symbol for removal.

Avoid:

- `@param` / `@returns` — the type signature carries the contract; descriptive prose belongs in `@remarks` Algorithm.
- `@throws` — capture failure modes in `@remarks` instead so they appear in the rendered `DOCS.md` business-logic panel.

## Workflow

1. Identify every public `export` declaration in the touched file. The strict feature-doc check tells you which ones are missing.
2. For each declaration:
   - If service-like / policy-like / policy-constant → write `summary` + `@remarks` per the structure above.
   - Otherwise → write a `summary` only.
3. For nested exports (methods inside an exported class), TSDoc the methods you want documented in addition to the class. The generator currently pairs only with `export <kind> <name>` declarations, so nested method docs are render-time best-effort. Author them anyway — they appear in IDE hover.
4. Run `pnpm features:generate` to refresh.
5. If the run reduces missing-token counts, also run `pnpm features:refresh-baseline` to lock the lower baseline.

## Anti-patterns

- ❌ TSDoc that just restates the symbol name ("`getUser` — gets a user"). Add the contract: what the input shape is, what the output guarantees, what the failure modes are.
- ❌ `@remarks` with empty sub-sections. If there's no Side effects, write "Side effects: none." Don't omit the heading.
- ❌ Auto-generated TODO placeholders. The validator flags `null` summaries; a placeholder summary like `// TODO` is technically non-null but reviewers will reject it.
- ❌ Disabling the strict gate (`--no-verify` on commit, skipping CI step) instead of authoring the doc.

## Cross-skill triggers

- New policy constant → also invoke **system-narrative-maintainer** (add the row to `src/POLICIES.md`).
- After authoring → always invoke **feature-doc-maintainer** to refresh the index.

## Related references

- TSDoc extractor: [`tooling/feature-docs/tsdoc-extractor.ts`](../../../tooling/feature-docs/tsdoc-extractor.ts)
- File classifier: [`tooling/feature-docs/file-classifier.ts`](../../../tooling/feature-docs/file-classifier.ts) (`SERVICE_LIKE_FILE_PATTERN`, `POLICY_LIKE_FILE_PATTERN`)
- Worked examples: every `*.service.ts` under `src/domains/audit/`, `src/domains/auth/sub-domains/auth-method/`.
