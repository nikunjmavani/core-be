# Response-code policy (core-be)

When to set which HTTP status — the single contract every route, test, and doc follows. The policy is **enforced in code**, not by convention: the success side by `src/shared/middlewares/core/method-status-policy.middleware.ts` plus the route-status gates, the documented error side by `tooling/openapi/emitters/responses-builder.ts`.

---

## Success statuses — by method, never per-handler

| Method | Status | Meaning |
| ------ | ------ | ------- |
| GET | **200** | Resource(s) returned. |
| POST | **201** | Resource created / action accepted. The central `onSend` hook rewrites any 200/202/204 a POST handler produced to 201 — controllers never hand-pick. |
| PUT / PATCH | **200** | Updated resource returned. |
| DELETE | **204** | Deleted/revoked; no body. |

**Exceptions (protocol-owned, stay 200):** `POST /api/v1/billing/webhook`, `POST /api/v1/billing/stripe/webhook` (Stripe expects a 200 acknowledgement) and `POST /api/v1/mcp` (the MCP streamable-HTTP transport owns its codes). The exemption list is `METHOD_STATUS_POLICY_EXEMPT_PREFIXES` in the middleware.

**Where the truth lives and how it is enforced:**

1. Declared: `tooling/openapi/route-catalog/route-success-statuses.json` — one entry per route; `pnpm validate:route-success-statuses` keeps it in sync with `docs/routes.txt`.
2. Enforced at runtime: the method-status middleware (above).
3. Observed: `pnpm validate:route-success-coverage` after a full `pnpm test` fails CI on declared-vs-observed drift.
4. Documented: the OpenAPI responses builder reads the registry — the spec can never disagree with the declared status.

**Adding a route:** pick the status from the method table (don't invent), run `pnpm routes:catalog`, add the registry entry, write the happy-path test asserting that status.

## Error statuses — when each one applies

| Status | Use when | Emitted by |
| ------ | -------- | ---------- |
| **400** | Request shape is invalid — body field, path param, or query param fails Zod validation (response carries per-field `details: [{ field, message }]`), malformed JSON hits the parser, or a webhook signature fails. Documented on every POST/PATCH/PUT and on any route with path or query params; **omitted entirely** only on param-less, query-less GET/DELETE (nothing to validate). | Validators / Zod type provider / Fastify parser |
| **401** | `Authorization` header missing, malformed, or carries an expired/revoked access token. Message tells the developer how to recover (login → `Authorization: Bearer <ACCESS_TOKEN>`). | Auth middleware |
| **403** | Authenticated but not allowed: missing organization permission, role too low, suspended membership. | Permission guards |
| **404** | Resource id (or route) does not exist — including ids of the right shape but no row, and ids that belong to another organization (no existence leak). | Services / repositories |
| **406** | MCP route only — `Accept` header missing or names an unsupported media type. | MCP transport |
| **409** | Mutating routes — state conflict: duplicate resource (slug/email already taken), invalid state transition, or an in-flight duplicate request with the same `Idempotency-Key`. | Services + idempotency middleware |
| **413** | POST/PATCH/PUT — request body exceeds the size limit. | Fastify body limit |
| **415** | POST/PATCH/PUT — `Content-Type` is not `application/json` (where a JSON body is expected). | Fastify content-type parser |
| **422** | Mutating routes — request is well-formed but violates a business rule, or an `Idempotency-Key` is reused with a **different payload** (fingerprint mismatch). | Services + idempotency middleware |
| **429** | Any route — global or per-route rate limit exhausted. Response carries `Retry-After` and `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`. | Rate-limit middleware |
| **500** | Unexpected failure. Never intentional: the never-5xx fuzz gate (`src/tests/security/`) fails CI if any route 5xxes on malformed input. External message is generic; details go to Sentry. | Error handler |

**Decision guide for a new failure path:** is the request unreadable → 400/413/415; unauthenticated → 401; authenticated but not allowed → 403; thing doesn't exist → 404; valid request colliding with current state → 409; valid request breaking a business rule → 422; too fast → 429. If none fit, you are probably about to invent a status — don't; map it to the closest above.

**400 vs 422:** 400 = the request itself is malformed (shape). 422 = the request parses fine but the system rejects its meaning (semantics). **409 vs 422:** 409 = conflict with existing state (try again may succeed after state changes). 422 = the payload's logic is wrong (retrying identical payload always fails).

**Capability not available for a resource type → 422 (not 409).** When a route is rejected because the active resource is the wrong *kind* — most importantly a **personal organization** rejecting a team-only action (invite/add member, custom roles, transfer ownership, delete org) — use **422**. The organization `type` is immutable, so retrying the identical request always fails; that is the 422 rule, not the 409 "conflict with current state" rule (which implies a later retry could succeed). These rejections keep their i18n keys (`errors:personalOrganizationNoMembers` / `NoRoles` / `Immutable`). Clients can avoid the 422 entirely by reading the `capabilities` object on the organization response (see [route-consistency-and-org-model.md](./route-consistency-and-org-model.md)).

## Method and verb conventions

The HTTP method and any action suffix follow fixed rules so the surface reads predictably (enforced by review + the route catalog):

- **PUT = full replace** of a set or singleton (`/users/me/notification-preferences`, `/organization/roles/:role_id/permissions`, avatar/logo). **PATCH = partial merge** of fields (`/organization/settings`, `/organization/memberships/:membership_id`, subscriptions). Returns 200 either way.
- **Single-resource state change → `PATCH /resource/:id/<state>`** (e.g. `PATCH /notifications/:id/read`). **Collection action with no id → `POST /collection/<verb>`** (e.g. `POST /notifications/mark-all-read`). Both are intentional; do not "fix" one to match the other.
- **Lifecycle actions are `POST /resource/:id/<verb>`** (`/subscriptions/:id/cancel|resume|change-plan`, `/api-keys/:id/rotate`, `/invitations/:id/accept|decline|resend`, `/memberships` `leave` / `transfer-ownership`). The invitation "kill" action is **revoke** (`DELETE /organization/invitations/:invitation_id`) — the term is "revoke" everywhere (DB `revoked_at`, audit `member_invitation.revoke`, route summary), never "cancel".
- **`audit/logs` vs `audit-logs` is intentional:** `GET /api/v1/audit/logs` is the platform-admin global feed (the flat `audit` domain); `GET /api/v1/tenancy/organization/audit-logs` is the org-scoped feed (a sub-resource of the active organization). Different domains, different audiences — the spellings are not unified on purpose.

## Error body shape

All error statuses share one envelope (`src/shared/middlewares/core/error-handler.middleware.ts`):

```json
{
  "error": { "code": "VALIDATION_ERROR", "message": "Invalid request body", "details": [{ "field": "email", "message": "Invalid email format" }] },
  "meta": { "request_id": "018f2c7a-3b4d-4e5f-9a6b-7c8d9e0f1a2b" }
}
```

`details` appears on 400 only. `request_id` is the server-minted UUID (also echoed as `X-Request-Id`) — quote it in support tickets. All `message` values are i18n keys resolved per `Accept-Language`.

## Related

- Header matrix and id conventions: `agent-os/skills/api-contract-guard/SKILL.md`
- Versioning / `Sunset` / `Deprecation`: [api-versioning.md](api-versioning.md)
- Spec/Postman generation: [api-documentation.md](api-documentation.md)
