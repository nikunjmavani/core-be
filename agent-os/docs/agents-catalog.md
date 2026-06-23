# Agent catalog (core-be)

All 10 project agents. Each is read-only; most wrap a project skill (verifier, changelog-reviewer, and stack-monitor are inline).
See [platform-access.md](platform-access.md) for how to invoke on each platform.

| Agent | File | Wraps skill | Use when |
| ----- | ---- | ----------- | -------- |
| **production-reviewer** | [`agent-os/agents/production-reviewer.md`](../agents/production-reviewer.md) | path-to-production-gate + production-hardening-guard | Pre-release / deploy sign-off — full readiness plan |
| **verifier** | [`agent-os/agents/verifier.md`](../agents/verifier.md) | *(inline)* | After claiming work complete — scoped validate/tests + wiring check |
| **ci-investigator** | [`agent-os/agents/ci-investigator.md`](../agents/ci-investigator.md) | ci-investigator | One failing CI job — root-cause summary without log noise |
| **production-hardening-reviewer** | [`agent-os/agents/production-hardening-reviewer.md`](../agents/production-hardening-reviewer.md) | production-hardening-guard | Targeted hardening sweep — security headers, DB/Redis/worker gaps |
| **docs-auditor** | [`agent-os/agents/docs-auditor.md`](../agents/docs-auditor.md) | docs-audit | Full docs/ audit — stale links, index gaps, Mermaid issues |
| **sql-design-reviewer** | [`agent-os/agents/sql-design-reviewer.md`](../agents/sql-design-reviewer.md) | sql-design-guard | Schema design review — indexes, constraints, column conventions |
| **dependency-auditor** | [`agent-os/agents/dependency-auditor.md`](../agents/dependency-auditor.md) | dependency-security | `pnpm audit` — vulnerabilities + prioritized fix plan |
| **tsdoc-coverage-reviewer** | [`agent-os/agents/tsdoc-coverage-reviewer.md`](../agents/tsdoc-coverage-reviewer.md) | tsdoc-export-guard *(check phase)* | TSDoc gap scan — missing summaries and @remarks |
| **changelog-reviewer** | [`agent-os/agents/changelog-reviewer.md`](../agents/changelog-reviewer.md) | *(inline)* | Verify CHANGELOG.md vs git log / merged PR titles — gap report |
| **stack-monitor** | [`agent-os/agents/stack-monitor.md`](../agents/stack-monitor.md) | *(inline)* | Periodic / continuous stack monitoring — health verdict + anomalies from the dashboards MCP data tools (never the HTML UI) |
