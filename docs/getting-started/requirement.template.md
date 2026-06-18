# Requirement intake form (core-be)

This is the **one format** `/build-requirement` expects. Copy the blank form below,
fill every section, and run **`/build-requirement`** (paste the filled form, or pass a
path to it). You fill this form; the command builds the full production-ready vertical
slice from it and emits a reports bundle.

## How to fill it

- Keep the `## N.` headings exactly as written — they are the sections the build reads.
- Replace every `<...>` placeholder. If a section truly doesn't apply, write `none`.
- Anything you mark `default` uses the **Default assumptions** table in
  [`requirement-intake.md`](requirement-intake.md) (access, pagination, soft-delete,
  tenancy, tests, i18n, validation, API version, branch).
- `/build-requirement` is best-effort: for any section left blank, still a `<...>`
  placeholder, or ambiguous, it asks you to fill the gap before building — it never
  guesses the data model, auth, or tenancy.

## Blank form (copy this)

```markdown
# Requirement: <one-line title>

## 1. Summary & placement
- Purpose: <what + why, 1–2 lines>
- Domain / sub-domain: <e.g. billing / invoice>  (new or existing)

## 2. Data model
- Table(s): <name(s) | none>
- Columns: <name: type, notNull?, default?, unique?, FK?>  (text, never varchar)
- Public-id prefix: <e.g. inv>
- Relations / indexes: <...>
- Tenancy: <org-scoped? RLS on?> | Soft-delete: <yes/no> | Audit: <created_by? events?>

## 3. Public API
- Endpoints: <METHOD /path — purpose>  (snake_case semantic params)
- Auth per route: <public | authenticated | org-permission:<code> | global-role:admin>
- Request body: <snake_case fields + validation>
- Response: <serialized fields; external id>
- Statuses: <success + error> | Headers: <idempotency? captcha?> | Pagination: <cursor?>

## 4. Business logic
- Service intent per operation: <...>
- Transactions / cross-domain (via services): <...>
- Events / workers: <event name, queue, payload, behavior | none>
- Idempotency: <which writes | none> | Caching / rate limits: <...>

## 5. i18n
- Message keys + English copy: <errors.*, success.* | none>

## 6. Seed data
- Reference rows: <... | none> | Bulk/faker: <... | none>

## 7. Tests
- Happy paths: <...>
- Edge cases / auth & tenant boundaries / validation failures / idempotency replays: <...>

## 8. Non-functionals
- Observability / performance budget / security notes: <... | default>
```

## Worked example (what a filled form looks like)

```markdown
# Requirement: Organization invoices

## 1. Summary & placement
- Purpose: Let org admins list and fetch their billing invoices.
- Domain / sub-domain: billing / invoice  (new sub-domain)

## 2. Data model
- Table(s): invoices
- Columns: organization_id: bigint notNull FK organizations.id; amount_cents: bigint notNull; currency: text notNull default 'usd'; status: text notNull; issued_at: timestamptz notNull
- Public-id prefix: inv
- Relations / indexes: index (organization_id, issued_at)
- Tenancy: org-scoped, RLS on | Soft-delete: no (immutable ledger) | Audit: created_at only

## 3. Public API
- Endpoints: GET /api/v1/billing/invoices — list; GET /api/v1/billing/invoices/{invoice_id} — get one
- Auth per route: org-permission:billing.read
- Request body: none (list takes a cursor query param)
- Response: id, amount_cents, currency, status, issued_at
- Statuses: 200 success, 404 not found | Headers: none | Pagination: cursor

## 4. Business logic
- Service intent per operation: listInvoices(orgContext, cursor); getInvoice(orgContext, invoiceId)
- Transactions / cross-domain (via services): read-only
- Events / workers: none
- Idempotency: none | Caching / rate limits: default

## 5. i18n
- Message keys + English copy: errors.invoice_not_found "Invoice not found."

## 6. Seed data
- Reference rows: none | Bulk/faker: 20 invoices per seeded org

## 7. Tests
- Happy paths: list returns the org's invoices paginated; get returns one by id
- Edge cases / auth & tenant boundaries / validation failures / idempotency replays: 404 for another org's invoice (tenant boundary); 403 without billing.read; invalid cursor 400

## 8. Non-functionals
- Observability / performance budget / security notes: list p95 < 100ms; RLS enforces org isolation
```
