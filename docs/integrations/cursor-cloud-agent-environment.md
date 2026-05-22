# Cursor cloud agent development environment (core-be)

Use this when you run **Cursor cloud agents** (or similar automation) against this repository and need a Linux environment with **full dependencies** (including devDependencies), **Git**, and **SSH client** for typical agent workflows.

---

## Which Dockerfile to use

| File                                         | Purpose                                                                                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`Dockerfile`](../../Dockerfile)             | **Production** image: multi-stage build, compiled `dist/`, production-only `pnpm install --prod`. Use for deployment, not for running the full test suite or agents that need dev tooling.                                       |
| [`Dockerfile.agent`](../../Dockerfile.agent) | **Agent / development** image: Node 24 on Debian slim, installs all dependencies from the lockfile, copies the full repository. Use as the base for cloud agent environments when agents need to lint, typecheck, or run Vitest. |

---

## Building the agent image locally

From the repository root:

```bash
docker build -f Dockerfile.agent -t core-be-agent .
```

The build context is the full repo. The committed [`.dockerignore`](../../.dockerignore) excludes `node_modules/`, `dist/`, host `docs/`, `.env*`, and test/lint configs from the **build context** — not from the final image. The agent Dockerfile runs `pnpm install` then `COPY . .`, so agents get source and can run `pnpm docs:generate` / `pnpm routes:catalog` inside the container even when host `docs/` is absent from context.

---

## Multi-repository environments

Cursor supports **multi-repo** development environments so one agent session can mount several repositories (for example backend and frontend). See the [Cursor 3.4 changelog (May 13, 2026)](https://cursor.com/changelog/05-13-26) and [Cloud agent setup](https://cursor.com/docs/cloud-agent/setup) for configuration as code, versioning, and Governance.

---

## Private package registries and build secrets

If `pnpm install` must reach a **private npm registry**, configure **build secrets** in your agent environment Dockerfile or host platform so credentials are available only at image build time and are not baked into image layers or the running agent environment. Follow your registry provider’s and Cursor’s documentation for secret mounting; do not commit tokens or `.npmrc` secrets to this repository.

---

## Runtime services (Postgres, Redis)

This image does **not** start PostgreSQL or Redis. For tests that need a database, either:

- Point `DATABASE_URL` and `REDIS_URL` at services started by your agent platform or compose, or
- Follow [getting-started/setup.md](../getting-started/setup.md) for local `docker compose` and `.env`.

---

## Related documentation

- [cursor-backend-mcp.md](cursor-backend-mcp.md) — MCP endpoint for tooling in Cursor when the API runs with `ENABLE_MCP_SERVER=true`.
- [getting-started/setup.md](../getting-started/setup.md) — Local human setup and validation commands.
