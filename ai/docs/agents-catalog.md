# Agent catalog (core-be)

All 8 project agents. Each is read-only and wraps a project skill.
See [platform-access.md](platform-access.md) for how to invoke on each platform.

| Agent | File | Wraps skill | Use when |
| ----- | ---- | ----------- | -------- |
| **production-reviewer** | [`ai/agents/production-reviewer.md`](../agents/production-reviewer.md) | path-to-production-gate + production-hardening-guard | Pre-release / deploy sign-off — full readiness plan |
| **verifier** | [`ai/agents/verifier.md`](../agents/verifier.md) | *(inline)* | After claiming work complete — scoped validate/tests + wiring check |
| **ci-investigator** | [`ai/agents/ci-investigator.md`](../agents/ci-investigator.md) | ci-investigator | One failing CI job — root-cause summary without log noise |
| **production-hardening-reviewer** | [`ai/agents/production-hardening-reviewer.md`](../agents/production-hardening-reviewer.md) | production-hardening-guard | Targeted hardening sweep — security headers, DB/Redis/worker gaps |
| **docs-auditor** | [`ai/agents/docs-auditor.md`](../agents/docs-auditor.md) | docs-audit | Full docs/ audit — stale links, index gaps, Mermaid issues |
| **sql-design-reviewer** | [`ai/agents/sql-design-reviewer.md`](../agents/sql-design-reviewer.md) | sql-design-guard | Schema design review — indexes, constraints, column conventions |
| **dependency-auditor** | [`ai/agents/dependency-auditor.md`](../agents/dependency-auditor.md) | dependency-security | `pnpm audit` — vulnerabilities + prioritized fix plan |
| **tsdoc-coverage-reviewer** | [`ai/agents/tsdoc-coverage-reviewer.md`](../agents/tsdoc-coverage-reviewer.md) | tsdoc-export-guard *(check phase)* | TSDoc gap scan — missing summaries and @remarks |
