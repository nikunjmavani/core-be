---
name: openapi-route-sync
description: Keeps OpenAPI route metadata in sync when routes change. Use after adding, removing, or updating *.routes.ts — with route-catalog. Updates openapi-enricher routeMetadataMap and locale tags when needed.
---

# OpenAPI Route Sync (core-be)

## Purpose

**route-catalog** updates `docs/routes.txt`. This skill keeps **OpenAPI documentation** aligned: operation summaries, tags, and locale copy for the docs generator.

## When to use

Run **after route-catalog** whenever `*.routes.ts` changes:

- New route registered
- Path, method, or access changed
- Route removed

Also invoke **openapi-multilingual** when adding new tags or response keys in locale files.

## Files to update

| File                                 | What to add                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `src/scripts/codegen/openapi-enricher.ts`    | Entry in `routeMetadataMap`: key `"METHOD /full/openapi/path"` → `{ summary, description, tags }` |
| `src/shared/locales/en/openapi.json` | New **tags** entries for any new tag name used                                                    |
| `src/shared/locales/es/openapi.json` | Same tag keys as English (translated descriptions)                                                |

Route key format matches Fastify/OpenAPI paths (e.g. `'GET /api/v1/tenancy/organizations/:id'`).

## Steps

1. **Build the route key** — method + full path as registered (include `/api/v1/...` prefix from `src/routes.ts`).
2. **Add `routeMetadataMap` entry** with clear summary, one-sentence description, and existing or new tag (match domain: `Auth`, `Tenancy`, `Billing`, etc.).
3. **New tag?** Add the tag name and description to **all** `src/shared/locales/*/openapi.json` `tags` objects.
4. **Generate specs**:
   ```bash
   pnpm docs:generate:multilang
   ```
5. Optional: `pnpm docs:postman` if Postman collection must be refreshed for the team.

## Relation to other skills

| Skill                         | Role                                           |
| ----------------------------- | ---------------------------------------------- |
| **route-catalog**             | `docs/routes.txt`                              |
| **openapi-route-sync** (this) | `openapi-enricher.ts` + locale tags            |
| **openapi-multilingual**      | Full locale parity, new locales, response keys |

## Checklist

- [ ] Every new public/authenticated route has a `routeMetadataMap` entry
- [ ] Removed routes deleted from `routeMetadataMap`
- [ ] New tags present in `en` and `es` `openapi.json`
- [ ] `pnpm docs:generate:multilang` run (or noted for CI)

## Anti-patterns

- Relying on generic fallback summaries for user-facing API docs
- Updating only `docs/openapi/*.json` by hand (generated artifacts)
