# Agent catalog (core-be)

<!-- GENERATED:START -->
All 10 project agents — each read-only. Generated from `agents/*.md` frontmatter
and `agents/pipelines.json`. See [platform-access.md](platform-access.md) for how to invoke on each platform.

| Agent | File | Wraps skill | Model | Pipelines | Use when |
| ----- | ---- | ----------- | ----- | --------- | -------- |
| **changelog-reviewer** | [`agent-os/agents/changelog-reviewer.md`](../agents/changelog-reviewer.md) | *(inline)* | `inherit` | — | Verify CHANGELOG.md vs git log / merged PR titles — gap report |
| **ci-investigator** | [`agent-os/agents/ci-investigator.md`](../agents/ci-investigator.md) | ci-investigator | `inherit` | — | One failing CI job — root-cause summary without log noise |
| **dependency-auditor** | [`agent-os/agents/dependency-auditor.md`](../agents/dependency-auditor.md) | dependency-security | `inherit` | prod-readiness | pnpm audit — vulnerabilities + prioritized fix plan |
| **docs-auditor** | [`agent-os/agents/docs-auditor.md`](../agents/docs-auditor.md) | docs-audit | `inherit` | — | Full docs/ audit — stale links, index gaps, Mermaid issues |
| **production-hardening-reviewer** | [`agent-os/agents/production-hardening-reviewer.md`](../agents/production-hardening-reviewer.md) | production-hardening-guard | `inherit` | pre-merge-review, prod-readiness | Targeted hardening sweep — security headers, DB/Redis/worker gaps |
| **production-reviewer** | [`agent-os/agents/production-reviewer.md`](../agents/production-reviewer.md) | path-to-production-gate + production-hardening-guard | `inherit` | prod-readiness | Pre-release / deploy sign-off — full readiness plan |
| **sql-design-reviewer** | [`agent-os/agents/sql-design-reviewer.md`](../agents/sql-design-reviewer.md) | sql-design-guard | `inherit` | pre-merge-review | Schema design review — indexes, constraints, column conventions |
| **stack-monitor** | [`agent-os/agents/stack-monitor.md`](../agents/stack-monitor.md) | *(inline)* | `inherit` | — | Periodic / continuous stack monitoring — health verdict + anomalies from the dashboards MCP data tools (never the HTML UI) |
| **tsdoc-coverage-reviewer** | [`agent-os/agents/tsdoc-coverage-reviewer.md`](../agents/tsdoc-coverage-reviewer.md) | tsdoc-export-guard *(check phase)* | `inherit` | — | TSDoc gap scan — missing summaries and @remarks |
| **verifier** | [`agent-os/agents/verifier.md`](../agents/verifier.md) | *(inline)* | `inherit` | pre-merge-review | After claiming work complete — scoped validate/tests + wiring check |
<!-- GENERATED:END -->

> Each agent is read-only (Cursor `readonly` + a Claude `tools` allowlist that excludes write tools).
> Most wrap a project skill (diagnostic → procedural handoff: the agent finds, the skill fixes);
> `verifier`, `changelog-reviewer`, and `stack-monitor` run inline logic.
> Model routing (mechanical checkers → `haiku`, deep reasoners → `inherit`) is set per agent in its
> frontmatter and rendered in the **Model** column above.
