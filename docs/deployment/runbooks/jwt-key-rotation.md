# JWT key rotation

Production uses **RS256** with `kid` in the JWT header and optional multi-key verify via [`jwt.util.ts`](../../../src/shared/utils/security/jwt.util.ts). Access tokens expire in **15 minutes**.

| Env var                              | Purpose                                                  |
| ------------------------------------ | -------------------------------------------------------- |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Active signing key pair (PEM)                            |
| `JWT_SIGNING_KID`                    | `kid` claim in header when signing (default: `default`)  |
| `JWT_PUBLIC_KEYS`                    | Optional JSON `{ "kid": "PEM..." }` for rotation overlap |

When `JWT_PUBLIC_KEYS` is omitted, verification uses `JWT_PUBLIC_KEY` under `JWT_SIGNING_KID`.

---

## When to use which approach

| Scenario               | Action                                                                                                                | User impact                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| First deploy           | Set PEM keys + optional `JWT_SIGNING_KID` in GitHub Environment → Railway                                             | None                                                     |
| Emergency rotation     | Deploy new PEM pair only (single key in env); restart API/workers                                                     | Outstanding access tokens invalid until expiry (~15 min) |
| Zero-downtime rotation | Add new kid to `JWT_PUBLIC_KEYS`, update `JWT_SIGNING_KID` + `JWT_PRIVATE_KEY`, deploy, then remove old kid after TTL | Overlap window: old and new tokens both verify           |

---

## Zero-downtime rotation procedure

1. Generate new RSA key pair; choose a new kid (e.g. `2026-05-prod-b`).
2. Add the **new** public PEM to `JWT_PUBLIC_KEYS` under the new kid; keep the **old** public PEM under the previous kid.
3. Set `JWT_SIGNING_KID` to the new kid and deploy the new `JWT_PRIVATE_KEY`.
4. Wait **≥ 15 minutes** (max access token lifetime).
5. Remove the old kid from `JWT_PUBLIC_KEYS`; deploy again.
6. Monitor Sentry for elevated `401` / token errors.

**Example `JWT_PUBLIC_KEYS` (single-line JSON in env):**

```json
{
  "2026-05-prod-a": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----",
  "2026-04-prod-a": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
}
```

---

## Emergency rotation (single key)

1. Generate new RSA key pair.
2. Replace `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` (or replace only entry in `JWT_PUBLIC_KEYS` and update `JWT_SIGNING_KID`).
3. Deploy API and worker.
4. Wait ≥ 15 minutes before decommissioning the old key material.

---

## Related

- [credentials-and-env.md](../../integrations/credentials-and-env.md) — `JWT_*` variables
- [runbook-dev-to-production.md](runbook-dev-to-production.md) — production go-live checklist
