# JWT key rotation

Production uses **RS256** with `kid` in the JWT header and a single active public key via [`jwt.util.ts`](../../../src/shared/utils/security/jwt.util.ts). Access tokens expire in **15 minutes**.

| Env var                              | Purpose                                                 |
| ------------------------------------ | ------------------------------------------------------- |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY` | Active signing key pair (PEM)                           |
| `JWT_SIGNING_KID`                    | `kid` claim in header when signing (default: `default`) |

Verification always uses `JWT_PUBLIC_KEY`. There is no multi-key overlap; rotation is a single-key swap and accepts a short window of `401`s for tokens issued just before the swap (bounded by the 15-minute access-token TTL).

---

## When to use which approach

| Scenario       | Action                                                                                  | User impact                                                                |
| -------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| First deploy   | Set `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` (and optional `JWT_SIGNING_KID`) in GitHub env | None                                                                       |
| Planned rotation | Replace `JWT_PRIVATE_KEY` + `JWT_PUBLIC_KEY` together; bump `JWT_SIGNING_KID`; deploy  | Tokens issued under the old key fail verification until clients re-auth (~15 min) |
| Emergency rotation | Same as planned rotation; expect a short 401 burst until access tokens expire        | Same as above                                                              |

> Zero-downtime rotation via a JSON map of multiple public keys is no longer supported. If you need overlap, run two deployments behind a load balancer with separate `JWT_PUBLIC_KEY` values during the cutover window.

---

## Single-key rotation procedure

1. Generate a new RSA key pair.
2. Choose a new kid (e.g. `2026-05-prod-b`).
3. Replace `JWT_PRIVATE_KEY` and `JWT_PUBLIC_KEY` in the GitHub Environment for the target deployment.
4. Set `JWT_SIGNING_KID` to the new kid.
5. Deploy API and worker.
6. Wait **≥ 15 minutes** before decommissioning the old key material (covers the access-token TTL).
7. Monitor Sentry for elevated `401` / token errors. A short burst right after the swap is expected; sustained errors after the TTL window indicate a misconfiguration.

---

## Related

- [credentials-and-env.md](../../integrations/credentials-and-env.md) — `JWT_*` variables
- [runbook-dev-to-production.md](runbook-dev-to-production.md) — production go-live checklist
