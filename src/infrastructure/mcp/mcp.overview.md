`src/infrastructure/mcp/`

# MCP (Model Context Protocol) infrastructure

## Purpose

Optional MCP server endpoint that lets a developer's coding agent introspect this backend through MCP — listing routes, fetching the current OpenAPI document, and invoking the `call_api` tool to call this platform's HTTP API in-process. Mounted at `/api/v1/mcp` (GET + POST) when `ENABLE_MCP_SERVER=true`. Requires a global admin JWT.

## Design decisions

- **Optional dependency**: `@modelcontextprotocol/sdk` is declared as an `optionalDependency`. The server falls back gracefully when the package isn't installed — useful for the production Docker image which doesn't ship it.
- **Dynamic import**: the SDK is imported only when the feature flag is on, so the dependency cost (in cold start time and bundle size) is paid only by deploys that enable it.
- **Two resources**: `core-be://openapi` (the generated OpenAPI document) and `core-be://routes` (the route catalog). Both are read-only.
- **One tool**: `call_api` invokes the local HTTP API through `fastify.inject()` — no extra TCP hop, no extra auth dance, scoped to the calling JWT's permissions.
- **Strict admin gating**: the auth preHandler requires a global `admin` or `super_admin` role. There is no per-organization MCP today.
- **`call_api` blast radius & R14 gating**: because `call_api` is an admin-authority in-process proxy into the *entire* `/api/v1/` surface, it is gated by `evaluateCallApiPolicy` (in `mcp-capabilities.ts`): (1) the path must start with `/api/v1/`, `/livez`, or `/readyz`; (2) caller-supplied `BLOCKED_HEADERS` (authorization/cookie/x-organization-id/…) are stripped so the sub-request can't pivot principal or tenant; (3) **read-only by default** — only `GET` is allowed unless `MCP_CALL_API_ALLOW_MUTATIONS=true`; (4) an optional operator allowlist `MCP_CALL_API_ALLOWED_PATH_PREFIXES` (CSV) further narrows reachable paths. Errors from the proxied call are logged server-side and returned to the client as a generic message (MCP responses bypass the global error masker via `reply.hijack()`).

## Operational concerns

- **Production posture**: ship with `ENABLE_MCP_SERVER=false` unless ops explicitly opts in. If enabled, `call_api` stays **read-only** (GET) unless `MCP_CALL_API_ALLOW_MUTATIONS=true` is also set, so enabling MCP cannot on its own expose destructive admin mutations through the tool.
- **In-process API invocation**: `call_api` reuses the same Fastify routing, middleware, and rate-limit pipeline that an external client would hit. Authorization is enforced exactly the same way.

## External dependencies

- **`@modelcontextprotocol/sdk`** — optional dependency; loaded only when `ENABLE_MCP_SERVER=true`.

## Failure modes

- **SDK package missing while flag is on** → server logs an error and the route returns 503. The rest of the platform is unaffected.
- **Non-admin JWT** → 403.
- **Tool call exceeds the per-call timeout** → standard Fastify timeout error class.

## Related docs

- [docs/integrations/cursor-backend-mcp.md](docs/integrations/cursor-backend-mcp.md) — usage from the Cursor editor.
