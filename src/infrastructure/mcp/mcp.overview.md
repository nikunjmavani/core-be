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

## Operational concerns

- **Production posture**: ship with `ENABLE_MCP_SERVER=false` unless ops explicitly opts in. The endpoint is admin-only but reduces attack surface to keep it disabled.
- **In-process API invocation**: `call_api` reuses the same Fastify routing, middleware, and rate-limit pipeline that an external client would hit. Authorization is enforced exactly the same way.

## External dependencies

- **`@modelcontextprotocol/sdk`** — optional dependency; loaded only when `ENABLE_MCP_SERVER=true`.

## Failure modes

- **SDK package missing while flag is on** → server logs an error and the route returns 503. The rest of the platform is unaffected.
- **Non-admin JWT** → 403.
- **Tool call exceeds the per-call timeout** → standard Fastify timeout error class.

## Related docs

- [docs/integrations/cursor-backend-mcp.md](docs/integrations/cursor-backend-mcp.md) — usage from the Cursor editor.
