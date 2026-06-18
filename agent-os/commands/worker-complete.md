---
description: Complete an events / queues / workers change end-to-end (the worker-change chain)
argument-hint: (no arguments)
allowed-tools: Bash(pnpm test*), Bash(pnpm validate*)
---

Run the **worker-change** chain (`agent-os/skills/chains.json`), in order:

1. **workers-events** — event emission/handlers, BullMQ queues/jobs, worker processors, graceful shutdown and retries. Keep worker DB isolation: use context wrappers, never `getRequestDatabase()` / `request-database.context` under `*.worker.ts` / `*.processor.ts`; tenant jobs carry `organizationPublicId`.
2. **test-generator** — unit + integration coverage for the queue/worker.
3. **tsdoc-export-guard** — TSDoc summary + `@remarks` (Algorithm / Failure modes / Side effects) on new worker/processor exports.

Finish green: `pnpm validate` + `pnpm test:unit`. Report the queues/workers touched.
