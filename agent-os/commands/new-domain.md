---
description: Scaffold a new domain or sub-domain following the domain-generator skill
argument-hint: <name and short description> e.g. "billing/invoice  invoices issued to organizations"
---

Scaffold a new domain or sub-domain: **$ARGUMENTS**

Procedure:
1. Consult `agent-os/skills/skill-index/SKILL.md` first to confirm which skills apply.
2. Follow the **domain-generator** skill (`agent-os/skills/domain-generator/SKILL.md`)
   and the domain structure in `CLAUDE.md`:
   - Layout under `src/domains/<domain>/...` (controller, service, repository, dto,
     validator, serializer, types; `<domain>.container.ts`; `<domain>.routes.ts`).
   - Wire DI in the container; register routes; export services for controllers.
3. Run the follow-up skills that match what you created: **schema-generator** +
   **db-migration-maintainer** (tables), **route-schema-doc-guard** +
   **route-catalog** + **seed-maintainer** (routes), **test-generator**,
   **tsdoc-export-guard**, **overview-doc-maintainer**.
4. Keep imports within the dependency rules — cross-domain access via services only.

Do not skip the skill-index step.
