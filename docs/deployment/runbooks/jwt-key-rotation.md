# JWT key rotation

Production uses **RS256** with a `kid` in the JWT header via [`jwt.util.ts`](../../../src/shared/utils/security/jwt.util.ts). Access tokens expire in **15 minutes**.

| Env var                              | Half     | Purpose                                                              |
| ------------------------------------ | -------- | -------------------------------------------------------------------- |
| `JWT_PRIVATE_KEY`                    | Secret   | Active RS256 signing key (PEM)                                       |
| `JWT_PUBLIC_KEY`                     | Variable | Single verification key (PEM) — fallback / single-key deploys        |
| `JWT_SIGNING_KID`                    | Variable | `kid` written into the header when signing (default: `default`)     |
| `JWT_PUBLIC_KEYS`                    | Variable | **Optional** `kid`→PEM verification keyring (JSON) for overlap       |

Signing always uses `JWT_PRIVATE_KEY` and stamps the header with `JWT_SIGNING_KID`. Verification selects the public key by the **token-header `kid`**: when `JWT_PUBLIC_KEYS` is set and contains the token's `kid`, that key is used; otherwise it falls back to the single `JWT_PUBLIC_KEY`. Tokens without a `kid`, and any deployment that leaves `JWT_PUBLIC_KEYS` unset, behave exactly as the single-key path.

---

## When to use which approach

| Scenario                | Action                                                                                                   | User impact                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| First deploy            | Set `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` (and optional `JWT_SIGNING_KID`)                                 | None                                                                     |
| Zero-downtime rotation  | Keep old + new public keys in `JWT_PUBLIC_KEYS`; sign with the new `JWT_SIGNING_KID`; drop old after TTL | **None** — old-kid tokens keep verifying during the overlap window       |
| Single-key swap (legacy)| Replace `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` together; bump `JWT_SIGNING_KID`; deploy                     | Tokens issued under the old key fail until clients re-auth (~15 min)     |

`JWT_PUBLIC_KEYS` is **additive and optional**: existing single-key deployments need no changes.

---

## Zero-downtime rotation procedure (overlap window)

1. Generate a new RSA key pair and choose a new kid (e.g. `2026-05-prod-b`). The ops script does this and prints a ready-to-paste `JWT_PUBLIC_KEYS` overlap map:

   ```bash
   pnpm ops:jwt:rotate --kid 2026-05-prod-b           # print-only (dry-run)
   pnpm ops:jwt:rotate --kid 2026-05-prod-b --apply   # push via `gh secret set`
   ```

2. Set `JWT_PUBLIC_KEYS` to a JSON map holding **both** the current and new public keys, keyed by their kids:

   ```text
   JWT_PUBLIC_KEYS={"2026-05-prod-a":"-----BEGIN PUBLIC KEY-----\n...","2026-05-prod-b":"-----BEGIN PUBLIC KEY-----\n..."}
   ```

3. Set `JWT_PRIVATE_KEY` to the new private key and `JWT_SIGNING_KID` to the new kid (`2026-05-prod-b`). Keep `JWT_PUBLIC_KEY` pointing at either key in the map (it is only the fallback now).
4. Deploy API **and** worker. New tokens are signed under the new kid; tokens minted under the old kid keep verifying against the old key in `JWT_PUBLIC_KEYS`.
5. Wait **≥ 15 minutes** (the access-token TTL, `ACCESS_TOKEN_EXPIRY_SECONDS`) so all old-kid tokens expire.
6. Remove the old kid from `JWT_PUBLIC_KEYS` and decommission the old key material. Monitor Sentry for `401` / token errors — there should be **no** burst with the overlap window in place.

---

## Single-key rotation procedure (no overlap)

Use only when you choose not to run a keyring.

1. Generate a new RSA key pair; choose a new kid.
2. Replace `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in the GitHub Environment.
3. Set `JWT_SIGNING_KID` to the new kid.
4. Deploy API and worker.
5. Expect a short `401` burst until in-flight access tokens expire (≤ 15 minutes).

---

## Related

- [credentials-and-env.md](../../integrations/credentials-and-env.md) — `JWT_*` variables
- [production-go-live.md](production-go-live.md) — production go-live checklist
- [`src/domains/auth/sub-domains/auth-session/auth-session.overview.md`](../../../src/domains/auth/sub-domains/auth-session/auth-session.overview.md) — JWT-per-session invariant, bounded revocation propagation
- [`src/POLICIES.md`](../../../src/POLICIES.md) — `JWT_ACCESS_TOKEN_TTL_MINUTES`, signing kid policy
- [secrets-management.md](../../reference/security/secrets-management.md) — field-secret encryption key rotation (separate keyring)
