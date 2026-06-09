# Changelog

All notable changes to this project will be documented in this file.

## [4.1.0](https://github.com/nikunjmavani/core-be/compare/v4.0.0...v4.1.0) (2026-06-09)


### Added

* **infra-tests:** drop_index_without_concurrently lint rule + org slug collision-proof factory ([#526](https://github.com/nikunjmavani/core-be/issues/526)) ([0915c85](https://github.com/nikunjmavani/core-be/commit/0915c851ab7b5c8934a06108d28f8aec3662e97b))
* **round-5-followup:** per-org row caps (api-keys, member-roles, notification-policies) + auth/MFA route policy tests ([#528](https://github.com/nikunjmavani/core-be/issues/528)) ([19b556f](https://github.com/nikunjmavani/core-be/commit/19b556f9379a3d70889644356e9928a68de549e9))
* **round-5:** residual-risk findings — DLQ-RLS bug + 5 backlog fixes + 3 test gaps + audit doc ([#527](https://github.com/nikunjmavani/core-be/issues/527)) ([6aa6f88](https://github.com/nikunjmavani/core-be/commit/6aa6f8831e12fa7c8ef88f3d95f9e15bcd2d23d2))


### Fixed

* **audit:** omit soft-deleted orgs from audit-log public id resolution (sec-r4-D2) ([#506](https://github.com/nikunjmavani/core-be/issues/506)) ([e76a015](https://github.com/nikunjmavani/core-be/commit/e76a01530ed22da2e35d21f0080547075d0475d8))
* **auth-webauthn:** require user verification at options time (sec-r4-A2) ([#514](https://github.com/nikunjmavani/core-be/issues/514)) ([38f60cf](https://github.com/nikunjmavani/core-be/commit/38f60cf8443a94ff327e95e6bad5d03d7bdf6947))
* **auth:** fix controller unit test and ack OpenAPI breaking change for B4 ([48f8c81](https://github.com/nikunjmavani/core-be/commit/48f8c818fa14f205efe5a6e12d2528e8461f6790))
* **auth:** sec-new-A2 reject suspended/deleted users on bearer auth cache miss ([#474](https://github.com/nikunjmavani/core-be/issues/474)) ([eff74f4](https://github.com/nikunjmavani/core-be/commit/eff74f453a57f071258b8275aa850d375e6a67cc))
* **auth:** sec-new-A3 preserve caller session on DELETE /me/sessions ([#478](https://github.com/nikunjmavani/core-be/issues/478)) ([32936f3](https://github.com/nikunjmavani/core-be/commit/32936f3625022fcb98a3b2f681b6d19ee86a7611))
* **auth:** sec-new-A4 flip is_mfa_enabled inside deleteMfa transaction ([#479](https://github.com/nikunjmavani/core-be/issues/479)) ([a50d899](https://github.com/nikunjmavani/core-be/commit/a50d8995f7c42b08643d6a503b70971d24cbf6e9))
* **auth:** sec-new-B4 add public_id to auth_methods, stop leaking bigserial ids ([c82295d](https://github.com/nikunjmavani/core-be/commit/c82295d43b2768b8fb53160c26704e3dabadf4ce))
* **auth:** sec-new-B4 add public_id to auth_methods, stop leaking bigserial ids ([02a6ddd](https://github.com/nikunjmavani/core-be/commit/02a6ddd7b4dff060e87709bfa74dcd955a679228))
* **billing:** bound PlanRepository.findAllActive at 100 rows (sec-r4-D3) ([#507](https://github.com/nikunjmavani/core-be/issues/507)) ([43180a9](https://github.com/nikunjmavani/core-be/commit/43180a98e2b62abdc0584460d06d455a55701900))
* **billing:** remove redundant parseBullMQJobData from stripe-webhook processor (sec-r4-Q1) ([#502](https://github.com/nikunjmavani/core-be/issues/502)) ([d20c731](https://github.com/nikunjmavani/core-be/commit/d20c731dbaf5764fcb0ebf96376830c882991205))
* **billing:** sec-new-B1 guard cancel/resume/changePlan against terminal subscriptions ([#475](https://github.com/nikunjmavani/core-be/issues/475)) ([86bb32f](https://github.com/nikunjmavani/core-be/commit/86bb32f6de0ed2c3e293f2a17f979b9cfbfc3328))
* **billing:** sec-new-D1-D2 data integrity guards in billing writes ([#476](https://github.com/nikunjmavani/core-be/issues/476)) ([def085a](https://github.com/nikunjmavani/core-be/commit/def085adf233218dac8c01dad35e2efde385313b))
* **billing:** sec-new-M2 emit Deprecation+Sunset headers on deprecated /stripe/webhook alias ([#489](https://github.com/nikunjmavani/core-be/issues/489)) ([d95f4aa](https://github.com/nikunjmavani/core-be/commit/d95f4aa8becdae0454be1d727a09c1580fb1ff4d))
* **billing:** support comma-separated STRIPE_WEBHOOK_SECRET for zero-downtime rotation (sec-new-B3) ([#490](https://github.com/nikunjmavani/core-be/issues/490)) ([4be65fe](https://github.com/nikunjmavani/core-be/commit/4be65fe218a948b63f9386a09a934aa4cb4d42e5))
* **ci:** dispatch stable release backmerge ([be9190f](https://github.com/nikunjmavani/core-be/commit/be9190f6ff26d04905bc46127717c96fbbe57ab0))
* **ci:** export GLOBAL_ADMIN_EMAILS in test-env so audit.test.ts super-admin paths work in Matrix Tests ([#532](https://github.com/nikunjmavani/core-be/issues/532)) ([873f59d](https://github.com/nikunjmavani/core-be/commit/873f59df59340bc182e3d8f261b5c2e435f89c63))
* **ci:** grant release-please job id-token + actions write permissions ([#536](https://github.com/nikunjmavani/core-be/issues/536)) ([b83eab2](https://github.com/nikunjmavani/core-be/commit/b83eab2d4ac3e2b46f5e77e00e34d720db6508e0))
* **config:** cap AUTH_SESSION_MAX_AGE_DAYS at 365 (sec-r4-C4) ([#510](https://github.com/nikunjmavani/core-be/issues/510)) ([2a48a88](https://github.com/nikunjmavani/core-be/commit/2a48a88355744445298e8fb36dda0c22fca0b472))
* **database:** sec-new-Q4 apply worker statement timeout in system-table retention context ([#487](https://github.com/nikunjmavani/core-be/issues/487)) ([4e0b5c2](https://github.com/nikunjmavani/core-be/commit/4e0b5c2156544d72b9dbf51b4a3c07b77930492a))
* **infra:** use correct JWT env keys in docker-compose smoke profile (sec-r4-C5) ([#512](https://github.com/nikunjmavani/core-be/issues/512)) ([c9a48f1](https://github.com/nikunjmavani/core-be/commit/c9a48f107f0f89fe41814c253e4d3defc0595437))
* **notify:** sec-new-B2 replace bigserial with public_id in X-Webhook-Delivery-Id header ([#494](https://github.com/nikunjmavani/core-be/issues/494)) ([771954a](https://github.com/nikunjmavani/core-be/commit/771954a360383fcb797e38a6ea55b07d2055790c))
* **notify:** sec-new-D4 add status=PENDING filter to fallback SELECT in webhook delivery ([#488](https://github.com/nikunjmavani/core-be/issues/488)) ([164c6f8](https://github.com/nikunjmavani/core-be/commit/164c6f8a0bebbc89f0bb47d0b432e0db0bf453d7))
* **notify:** sec-new-N1 validate webhookId path param in all webhook handlers ([#482](https://github.com/nikunjmavani/core-be/issues/482)) ([d66099e](https://github.com/nikunjmavani/core-be/commit/d66099e00764f935260de97560e60529d61d5e53))
* **notify:** trim payload and response_body from webhook delivery list (sec-r4-D6) ([#518](https://github.com/nikunjmavani/core-be/issues/518)) ([89c24b7](https://github.com/nikunjmavani/core-be/commit/89c24b7f05dba72eba97447f746abb08130c61f6))
* **queue:** sec-new-Q1 add env overrides for hardcoded cron schedules ([#484](https://github.com/nikunjmavani/core-be/issues/484)) ([d2d03e1](https://github.com/nikunjmavani/core-be/commit/d2d03e1c6a41861a22965a0c57707b8157ce66da))
* **queue:** sec-new-Q2 capture per-task failures in Sentry in recovery processor ([#485](https://github.com/nikunjmavani/core-be/issues/485)) ([b66a7a6](https://github.com/nikunjmavani/core-be/commit/b66a7a68ed27dc357b83b010e4778991fb198242))
* **runtime:** real-world deep-flow inspection findings — 3 fixes + regression test ([#533](https://github.com/nikunjmavani/core-be/issues/533)) ([5a85ecd](https://github.com/nikunjmavani/core-be/commit/5a85ecd7d19303cb45231ec2d73082dfd6d4e631))
* **sec:** account-deletion safety — invalidate verification tokens + revoke-before-purge (sec-U1+U8) ([#404](https://github.com/nikunjmavani/core-be/issues/404)) ([43a1e5a](https://github.com/nikunjmavani/core-be/commit/43a1e5aedc49cd19f2e082febeb9b247a6bea3cf))
* **sec:** add captchaPreHandler to POST /mfa/login (sec-new-A1) ([85d2a89](https://github.com/nikunjmavani/core-be/commit/85d2a892decb1cf9e882922188633de6ffdea5c0))
* **sec:** add captchaPreHandler to POST /mfa/login (sec-new-A1) ([f2c02db](https://github.com/nikunjmavani/core-be/commit/f2c02db0212721ec29b99633f455f36f8e9f23c9))
* **sec:** add closeUserDataExportQueue to worker shutdown sequence (sec-r4-R1) ([#501](https://github.com/nikunjmavani/core-be/issues/501)) ([6e8e96f](https://github.com/nikunjmavani/core-be/commit/6e8e96ff11af4819d22cfb34df5b27f125518cbd))
* **sec:** add deleted_at guards to org-discovery RLS and invitation lookup (sec-r4-T1/T2) ([#500](https://github.com/nikunjmavani/core-be/issues/500)) ([b4ea6ee](https://github.com/nikunjmavani/core-be/commit/b4ea6ee0969cd5ff8da76b7abb68823e711d5939))
* **sec:** add partial index for audit.logs.actor_api_key_id (sec-D8) ([#432](https://github.com/nikunjmavani/core-be/issues/432)) ([761f28b](https://github.com/nikunjmavani/core-be/commit/761f28b96207265002e24ad2f263da00ff97eb99))
* **sec:** audit append-only DB invariant — split tenant-isolation policy + REVOKE UPDATE (sec-U3) ([#409](https://github.com/nikunjmavani/core-be/issues/409)) ([7991dfc](https://github.com/nikunjmavani/core-be/commit/7991dfc486ed22eff946b346982285c1f87fee65))
* **sec:** audit every data-export URL mint, rate-limit GET, drop TTL 24h→15min (sec-U6) ([#429](https://github.com/nikunjmavani/core-be/issues/429)) ([4943057](https://github.com/nikunjmavani/core-be/commit/4943057037519b0c294e4e46405d202008083973))
* **sec:** audit every login surface, not just password (sec-A8) ([#427](https://github.com/nikunjmavani/core-be/issues/427)) ([9872491](https://github.com/nikunjmavani/core-be/commit/9872491ad9ee8271d3a063738dd3b1423013095c))
* **sec:** audit hygiene — denylist metadata strip + admin user-mgmt audit + admin audit-read audit + permission-deny audit (sec-U2+U9+U4+U13) ([#408](https://github.com/nikunjmavani/core-be/issues/408)) ([98e60ff](https://github.com/nikunjmavani/core-be/commit/98e60ff889e7c94d716aaf235c0b782d05bd4a8f))
* **sec:** audit login failures alongside successes on every login surface (sec-A8 follow-up) ([#438](https://github.com/nikunjmavani/core-be/issues/438)) ([e4a9c2f](https://github.com/nikunjmavani/core-be/commit/e4a9c2f88925653cf12910efbb6258ba2c7c1d73))
* **sec:** audit serializer is strip-only with resolved public ids (sec-re-08) ([#458](https://github.com/nikunjmavani/core-be/issues/458)) ([5a07fdb](https://github.com/nikunjmavani/core-be/commit/5a07fdb15f4706478587523c96f090a92a8a3ce1))
* **sec:** auth defense in depth — last login-method guard + super-admin rederive + step-up on session revoke (sec-A5+A6+A7) ([#407](https://github.com/nikunjmavani/core-be/issues/407)) ([021c4b3](https://github.com/nikunjmavani/core-be/commit/021c4b31ce8d3c619f48ebcf43e4393ad2cf9b3d))
* **sec:** bind audit-list pagination cursor to its minting filter set (sec-U12) ([#434](https://github.com/nikunjmavani/core-be/issues/434)) ([f6a40e2](https://github.com/nikunjmavani/core-be/commit/f6a40e2db1fc34916c236f5fc3a478d5d09020df))
* **sec:** block update() on org-owner membership to prevent Admin lockout (sec-new-T1) ([dfa526a](https://github.com/nikunjmavani/core-be/commit/dfa526a03dafa3ddae99029e34651aeffa979d51))
* **sec:** block update() on org-owner membership to prevent Admin lockout (sec-new-T1) ([c3c6cfe](https://github.com/nikunjmavani/core-be/commit/c3c6cfe24145ab0cc3e63fe8a8d3d1a20d5a7642))
* **sec:** breach compression-skip actually engages in production (sec-re-03) ([#454](https://github.com/nikunjmavani/core-be/issues/454)) ([5039ccd](https://github.com/nikunjmavani/core-be/commit/5039ccd0699dac287c89a94b85e9c6a4f630c25e))
* **sec:** build Stripe customer email from a platform-owned domain, not tenant slug (sec-B11) ([#436](https://github.com/nikunjmavani/core-be/issues/436)) ([8bb5338](https://github.com/nikunjmavani/core-be/commit/8bb533845fcf074150dc3796e2038dcab01df372))
* **sec:** cache the i18n preHandler organization → locale lookup (sec-M1) ([#440](https://github.com/nikunjmavani/core-be/issues/440)) ([180937a](https://github.com/nikunjmavani/core-be/commit/180937a42a83ec058d0e66823c534db54270cf73))
* **sec:** collapse unmatched-route Prometheus label into __unmatched__ sentinel (sec-C2) ([#401](https://github.com/nikunjmavani/core-be/issues/401)) ([5fc8743](https://github.com/nikunjmavani/core-be/commit/5fc87432500a76271dc867df7b68851e5e68ed74))
* **sec:** config + middleware hardening (sec-cm batch) ([#449](https://github.com/nikunjmavani/core-be/issues/449)) ([b150253](https://github.com/nikunjmavani/core-be/commit/b15025363ad4af584a93572f1a0afb5dc76f1e4f))
* **sec:** config cleanup — drop JWT_SECRET + add deps:audit:prod to ci:local + ENABLE_RESPONSE_ENCRYPTION pairing refine (sec-C5+C10+C11) ([#419](https://github.com/nikunjmavani/core-be/issues/419)) ([7cab170](https://github.com/nikunjmavani/core-be/commit/7cab17038463c7a568e36c48f4c10acc0e6235f3))
* **sec:** cors exposes x-client-request-id (sec-re-17) ([#467](https://github.com/nikunjmavani/core-be/issues/467)) ([8960cfc](https://github.com/nikunjmavani/core-be/commit/8960cfcc13b33e6abb222631ff5de62f3b1d9a7b))
* **sec:** data-export request route advertises 15-minute URL lifetime (sec-re-12) ([#462](https://github.com/nikunjmavani/core-be/issues/462)) ([bc7cea3](https://github.com/nikunjmavani/core-be/commit/bc7cea3c096583e338e25edca4d58d59616718c4))
* **sec:** db retention growth — verification token sweep + AUDIT_RETENTION_DAYS cap (sec-D5+U10) ([#415](https://github.com/nikunjmavani/core-be/issues/415)) ([ab9428b](https://github.com/nikunjmavani/core-be/commit/ab9428b5a5cd93a24ce283f8598dd318e0e0ef03))
* **sec:** db stability — drop volatile chk_org_notif_muted + worker statement_timeout + audit.logs target_user_id index (sec-D1+D2+D3) ([#414](https://github.com/nikunjmavani/core-be/issues/414)) ([f77ce4a](https://github.com/nikunjmavani/core-be/commit/f77ce4aee1366eaa1ff82da6575b5011dd382ca5))
* **sec:** delete dead findActiveByUserId / findActiveByOrganizationId (sec-D12) ([#437](https://github.com/nikunjmavani/core-be/issues/437)) ([6367dd4](https://github.com/nikunjmavani/core-be/commit/6367dd45ca44614f1e0a2d10fd2dfdf0df9f390e))
* **sec:** derive invitation email from membership user on create (sec-T1 complete) ([#471](https://github.com/nikunjmavani/core-be/issues/471)) ([6d54c99](https://github.com/nikunjmavani/core-be/commit/6d54c99a15cd6c1dc48ec3b1c6357c540db4bf29))
* **sec:** dlq replay no-op + commit-dispatch cleanup + worker hardening (sec-q batch) ([#444](https://github.com/nikunjmavani/core-be/issues/444)) ([6c96a0b](https://github.com/nikunjmavani/core-be/commit/6c96a0bb1c47d016d87735cbe16ee173e7de19c4))
* **sec:** do not clear session cookie in revokeAllSessions handler (sec-r4-A1) ([#499](https://github.com/nikunjmavani/core-be/issues/499)) ([b7e3952](https://github.com/nikunjmavani/core-be/commit/b7e395262f8ec06a84a5426b9c4a9dafa85ec351))
* **sec:** docker.agent USER node + drop openssh + enforce abort timeout on retrieveStripeEvent (sec-C8 + sec-Q5 partial) ([#422](https://github.com/nikunjmavani/core-be/issues/422)) ([d10af52](https://github.com/nikunjmavani/core-be/commit/d10af524ec39a00994b041f7727d18cc6e81639b))
* **sec:** document the online-safe ALTER COLUMN pattern (sec-D6) ([#443](https://github.com/nikunjmavani/core-be/issues/443)) ([c72deb4](https://github.com/nikunjmavani/core-be/commit/c72deb4e3f9b7cdaba267b14948fd73025dce3e3))
* **sec:** document verification_tokens application-trust safety model (sec-D9) ([#441](https://github.com/nikunjmavani/core-be/issues/441)) ([e069891](https://github.com/nikunjmavani/core-be/commit/e069891909cd0487a4cd5ab523930f8b0d6e105d))
* **sec:** drop org branch from user_notification_preferences RLS + add CHECK pin (sec-U7) ([#428](https://github.com/nikunjmavani/core-be/issues/428)) ([13fc188](https://github.com/nikunjmavani/core-be/commit/13fc188e22603b55f3226994399e5564e50f5843))
* **sec:** enforce SSE-S3 on every server-side S3 write (sec-U11) ([#435](https://github.com/nikunjmavani/core-be/issues/435)) ([0792d76](https://github.com/nikunjmavani/core-be/commit/0792d76c07ece878f8adc1f282f1966efbe54ae7))
* **sec:** expose policy public_id instead of bigserial in URLs and responses (sec-T5) ([#442](https://github.com/nikunjmavani/core-be/issues/442)) ([88d5db7](https://github.com/nikunjmavani/core-be/commit/88d5db72bc21184da5ea00ec0baaa0256d0f03a9))
* **sec:** extend staging guards to ALLOWED_ORIGINS, COOKIE_SECURE, and SECRETS_ENCRYPTION_KEY (sec-r4-C1/C2/C3) ([#498](https://github.com/nikunjmavani/core-be/issues/498)) ([0efd169](https://github.com/nikunjmavani/core-be/commit/0efd169841cea7cfba5197012dfb6e3f615fe629))
* **sec:** fall back to INSERT when subscription.created arrives before local row (sec-B9) ([#439](https://github.com/nikunjmavani/core-be/issues/439)) ([fd68e66](https://github.com/nikunjmavani/core-be/commit/fd68e660e7d19d1707b0bfe97ac4fe29d08ab427))
* **sec:** harden invitation binding, webhook retry, role invariants, and upload key contract ([#470](https://github.com/nikunjmavani/core-be/issues/470)) ([65cdf2f](https://github.com/nikunjmavani/core-be/commit/65cdf2f9179ac01aa1110f95b60cb6a7fd1519db))
* **sec:** invitation accept requires auth + invitee email match (sec-T4) ([#423](https://github.com/nikunjmavani/core-be/issues/423)) ([7cdc3f8](https://github.com/nikunjmavani/core-be/commit/7cdc3f83beafaa9e682bf39348cb1caa4047c2fb))
* **sec:** mark-confirmed-by-internal-id filters deleted_at and pending (sec-re-13) ([#463](https://github.com/nikunjmavani/core-be/issues/463)) ([dbd9156](https://github.com/nikunjmavani/core-be/commit/dbd9156fd40ff4e2e92ab6ace5823b2e60279e60))
* **sec:** mfa hardening — step-up requires mfa + per-session binding + org-policy delete guard (sec-A1+A2+A4) ([#403](https://github.com/nikunjmavani/core-be/issues/403)) ([1ba5047](https://github.com/nikunjmavani/core-be/commit/1ba504726442aaaea626d2b73f542c55b8214d0a))
* **sec:** mfa is_mfa_enabled flip happens inside the enrollConfirm transaction (sec-re-06) ([#469](https://github.com/nikunjmavani/core-be/issues/469)) ([675c1f2](https://github.com/nikunjmavani/core-be/commit/675c1f257bb02ecf3967a3295ff1f6d1068da136))
* **sec:** mfa re-enroll dedups stale totp factors (sec-re-04) ([#455](https://github.com/nikunjmavani/core-be/issues/455)) ([f7a66ab](https://github.com/nikunjmavani/core-be/commit/f7a66abb8218a13bbf92472ba3fc0c3e26ab6f3e))
* **sec:** middleware observability — captcha bypass closed in staging + HSTS env gate + ALLOWED_ORIGINS canonicalization + encryption 503 (sec-M3+M5+M8+M9) ([#417](https://github.com/nikunjmavani/core-be/issues/417)) ([57abed9](https://github.com/nikunjmavani/core-be/commit/57abed9c55fa7fc50c72b1161e8270b5a64b024f))
* **sec:** notification worker user context + db integrity indexes (sec-d batch) ([#450](https://github.com/nikunjmavani/core-be/issues/450)) ([a1a8fe5](https://github.com/nikunjmavani/core-be/commit/a1a8fe5c15fd5b3c4b8437413ef40e5b4efeb821))
* **sec:** notification worker user-context fix is live wiring (sec-re-01) ([#452](https://github.com/nikunjmavani/core-be/issues/452)) ([653adf5](https://github.com/nikunjmavani/core-be/commit/653adf5653b634dcf907927ad4f6a660256f8a79))
* **sec:** notify abuse caps — per-organization webhook cap + secret-rotation overlap window (sec-N4+N8) ([#411](https://github.com/nikunjmavani/core-be/issues/411)) ([a7455f5](https://github.com/nikunjmavani/core-be/commit/a7455f5548d20fe8460b92154e17b2ca75eda24a))
* **sec:** notify durability — worker re-checks disabled/deleted + delivery-id header + event_key dedupe (sec-N1+N3+N2) ([#410](https://github.com/nikunjmavani/core-be/issues/410)) ([c09ae6c](https://github.com/nikunjmavani/core-be/commit/c09ae6c7acad9de05fe7c28f365ba9af84795c16))
* **sec:** notify recipient + idempotency canonical fingerprint + tenant authorized-org helper (sec-N7+M6+M7) ([#420](https://github.com/nikunjmavani/core-be/issues/420)) ([17a8bbd](https://github.com/nikunjmavani/core-be/commit/17a8bbdc9d364eb9b5bfa5f71d0ffbe86e30645e))
* **sec:** org-scoped audit log sanitiser + strip-only serializers (sec-t batch) ([#448](https://github.com/nikunjmavani/core-be/issues/448)) ([6019182](https://github.com/nikunjmavani/core-be/commit/6019182b695080795d232d7afe04b96659ff34d2))
* **sec:** protect owner role from permission writes via ROLE_MANAGE (sec-T2) ([#402](https://github.com/nikunjmavani/core-be/issues/402)) ([6b11b6e](https://github.com/nikunjmavani/core-be/commit/6b11b6e6da7e825d48d7348b50576861a5fc4cbc))
* **sec:** queue infrastructure — defaultJobOptions on cron queues + flip topology warn + fail boot on scheduler drift in prod (sec-Q1+Q2+Q3) ([#416](https://github.com/nikunjmavani/core-be/issues/416)) ([32b960e](https://github.com/nikunjmavani/core-be/commit/32b960e03cc6a164d137dc080f583846b93635a9))
* **sec:** rate-limit per-email bucket id is hashed (sec-re-11) ([#461](https://github.com/nikunjmavani/core-be/issues/461)) ([4239be4](https://github.com/nikunjmavani/core-be/commit/4239be4ddb5d3432295565b4bb8e110612e97012))
* **sec:** recovery-code alphabet doc reflects 31 symbols and case-insensitive hash (sec-re-14) ([#464](https://github.com/nikunjmavani/core-be/issues/464)) ([1bc8b00](https://github.com/nikunjmavani/core-be/commit/1bc8b001519154b9e5da12abf4a4d808b12cd9d8))
* **sec:** refresh stale ordering comments around the no-op RLS-transaction plugin (sec-M4) ([#433](https://github.com/nikunjmavani/core-be/issues/433)) ([1bd211e](https://github.com/nikunjmavani/core-be/commit/1bd211e288ac062486e9374667e1619401e4f666))
* **sec:** refresh-token reuse detection fires for revoked sessions (sec-re-05) ([#456](https://github.com/nikunjmavani/core-be/issues/456)) ([bf5ee5e](https://github.com/nikunjmavani/core-be/commit/bf5ee5e30c0233d13a0f28d0b9b2afff4df0da4c))
* **sec:** remove privilege-bypass arms from audit.logs INSERT RLS (sec-r4-D1) ([#497](https://github.com/nikunjmavani/core-be/issues/497)) ([787b3c8](https://github.com/nikunjmavani/core-be/commit/787b3c8d20ebb37f97ef9cd2d27aa66f992df7c3))
* **sec:** replace z.coerce.boolean() foot-gun on env booleans (sec-C1) ([#400](https://github.com/nikunjmavani/core-be/issues/400)) ([f8a49c3](https://github.com/nikunjmavani/core-be/commit/f8a49c367e9bbc5cdc7e54e9d9c988e4dbe13bca))
* **sec:** repository hygiene — atomic markAllRead count + WebAuthn counter monotonicity guard (sec-D10/D11) ([#426](https://github.com/nikunjmavani/core-be/issues/426)) ([1d817db](https://github.com/nikunjmavani/core-be/commit/1d817db6ded2820f9334b31d05ca4e4b23ae30b2))
* **sec:** require caller can grant target role permissions on membership create (sec-T1) ([#399](https://github.com/nikunjmavani/core-be/issues/399)) ([899aab3](https://github.com/nikunjmavani/core-be/commit/899aab3abcf9de727a8b0e7fe3ecdcb7ad14d654))
* **sec:** require caller to hold every code added or removed on role-permission PUT (sec-T2) ([#425](https://github.com/nikunjmavani/core-be/issues/425)) ([b9b545e](https://github.com/nikunjmavani/core-be/commit/b9b545ee4de3c1b36bd05a8d80e8ebce8f497565))
* **sec:** require live-mode + both-or-neither Stripe keys in production (sec-B5/B6) ([#424](https://github.com/nikunjmavani/core-be/issues/424)) ([2ca7f2c](https://github.com/nikunjmavani/core-be/commit/2ca7f2cdb4e411275f465164b91ae2099f98a395))
* **sec:** role-delete guards + strip is_system from createMemberRoleDto (sec-T3) ([#406](https://github.com/nikunjmavani/core-be/issues/406)) ([1b41ab9](https://github.com/nikunjmavani/core-be/commit/1b41ab98cfaedfb11a7f5f3c87c26106e8bc2373))
* **sec:** sentry/log redaction + observability — OTLP https refine + readyz verbose env gate + Sentry message/exception/user redaction + LOG_LEVEL enum (sec-C3+C4+C6+C9) ([#418](https://github.com/nikunjmavani/core-be/issues/418)) ([b0337ce](https://github.com/nikunjmavani/core-be/commit/b0337ce2ad6f21ac16b0c97fccda158e7c64dd55))
* **sec:** stripe event retrieve honours per-attempt timeout for real (sec-re-15) ([#465](https://github.com/nikunjmavani/core-be/issues/465)) ([d5640da](https://github.com/nikunjmavani/core-be/commit/d5640daf8c1bacf06e9ca92894ac4d97a9945fe3))
* **sec:** stripe ingress durability + ordering + raw-body wiring (sec-b batch) ([#446](https://github.com/nikunjmavani/core-be/issues/446)) ([8a88beb](https://github.com/nikunjmavani/core-be/commit/8a88beb6cd7ea43f4cf42d034f2a37ba6a241d9e))
* **sec:** stripe reclaim cron→worker handoff is recoverable (sec-re-02) ([#453](https://github.com/nikunjmavani/core-be/issues/453)) ([3cdce4f](https://github.com/nikunjmavani/core-be/commit/3cdce4fcaabf0b6895b73c4feb412f0edd451080))
* **sec:** stripe reconciliation — close 4 silent-divergence paths (sec-B1+B2+B3+B4) ([#405](https://github.com/nikunjmavani/core-be/issues/405)) ([87ab3fb](https://github.com/nikunjmavani/core-be/commit/87ab3fb998f712f5a1b033708c1d65b9ba4c8b82))
* **sec:** subscription response surfaces plan public id (sec-re-07) ([#457](https://github.com/nikunjmavani/core-be/issues/457)) ([537325c](https://github.com/nikunjmavani/core-be/commit/537325c9f8f71a7e7452db8126bcb5517c8b2b1b))
* **sec:** sync local plan_id from Stripe customer.subscription.updated (sec-B7) ([#430](https://github.com/nikunjmavani/core-be/issues/430)) ([bc5a21a](https://github.com/nikunjmavani/core-be/commit/bc5a21ae87d6c253ad7094e752859fe254492d0e))
* **sec:** tenant context lifts the worker statement_timeout (sec-re-16) ([#466](https://github.com/nikunjmavani/core-be/issues/466)) ([415a58e](https://github.com/nikunjmavani/core-be/commit/415a58eb3a4c8c2334d8bcd5649f1348fdf9f455))
* **sec:** tombstoneAllByOrganizationId removes S3 objects synchronously (sec-UP8) ([#421](https://github.com/nikunjmavani/core-be/issues/421)) ([186bd71](https://github.com/nikunjmavani/core-be/commit/186bd711303862d3386cc6f7391ef0dd73928613))
* **sec:** two-phase mfa enrollment + refresh reuse-detection + login uniformity (sec-a batch) ([#445](https://github.com/nikunjmavani/core-be/issues/445)) ([d1e1e59](https://github.com/nikunjmavani/core-be/commit/d1e1e593bcf31c515f22fb1e2c4d07a89c76e81c))
* **sec:** upload confirm pins copy to verified etag (sec-re-10) ([#460](https://github.com/nikunjmavani/core-be/issues/460)) ([2eb3d11](https://github.com/nikunjmavani/core-be/commit/2eb3d11ca070c52c0e4fcf2cc5c5c0c391573837))
* **sec:** upload security — refuse legacy in-place + sweep refuses SVG + assertKeyConfirmedForOwner + DOMPurify hardening (sec-UP1+UP2+UP5+UP6) ([#412](https://github.com/nikunjmavani/core-be/issues/412)) ([76e80ad](https://github.com/nikunjmavani/core-be/commit/76e80ad3617b7d87f57fc292c6e41efba7f89d89))
* **sec:** upload size/policy — organizationId regex + org pending cap + force presigned POST in prod (sec-UP3+UP4+UP10) ([#413](https://github.com/nikunjmavani/core-be/issues/413)) ([237d517](https://github.com/nikunjmavani/core-be/commit/237d517905e321c9c73c1e9cc8f9fa181a73a597))
* **security:** strip Stripe-shaped literals from source + add regression test (GH secret-scanning) ([#529](https://github.com/nikunjmavani/core-be/issues/529)) ([f234e60](https://github.com/nikunjmavani/core-be/commit/f234e6044879c72385e3b61728ea4ba665931ae6))
* **sec:** validate membership and api-key path params at the boundary (sec-re-18) ([#468](https://github.com/nikunjmavani/core-be/issues/468)) ([c0ab171](https://github.com/nikunjmavani/core-be/commit/c0ab17106d8e7dd27513e3bf2f76a480775fd557))
* **sec:** validate subscriptionId path param at every billing handler (sec-B10) ([#431](https://github.com/nikunjmavani/core-be/issues/431)) ([2bbd338](https://github.com/nikunjmavani/core-be/commit/2bbd33864cd192a22d5d41f70ed7064a628a3809))
* **sec:** webhook secret strength + upload sweep file_key invariant + data-export doc (sec-up batch) ([#447](https://github.com/nikunjmavani/core-be/issues/447)) ([145c838](https://github.com/nikunjmavani/core-be/commit/145c8385ec8b02c25b0b508adbabd71c2ce8dc05))
* **storage:** enforce SSE-S3 on presigned uploads (sec-r4-E1) ([#509](https://github.com/nikunjmavani/core-be/issues/509)) ([f962d37](https://github.com/nikunjmavani/core-be/commit/f962d372565e05986fb00a2cef960694b4b35885))
* **tenancy:** bound MemberRolePermissionRepository.findByRoleId rows per role (sec-r4-D4) ([#508](https://github.com/nikunjmavani/core-be/issues/508)) ([9218518](https://github.com/nikunjmavani/core-be/commit/92185187cd5397f4f349442626a936f55e718b7b))
* **tenancy:** exclude soft-deleted orgs from organizations_tenant_isolation RLS policy (sec-new-D3) ([#491](https://github.com/nikunjmavani/core-be/issues/491)) ([904802a](https://github.com/nikunjmavani/core-be/commit/904802affcc95bea74e6f510b64c655ccbd46df0))
* **tenancy:** rate-limit membership lifecycle endpoints (sec-r4-I3) ([#505](https://github.com/nikunjmavani/core-be/issues/505)) ([1f0c8c0](https://github.com/nikunjmavani/core-be/commit/1f0c8c01d38bbaa6020b8a8cab7e3d5b0657b0b7))
* **tenancy:** rate-limit organization mutation endpoints (sec-r4-I2) ([#504](https://github.com/nikunjmavani/core-be/issues/504)) ([2f6bedb](https://github.com/nikunjmavani/core-be/commit/2f6bedb59ca27d9d11c68299560470d8f0418d77))
* **tenancy:** sec-new-M1 add STRICT_AUTHED_RATE_LIMIT to POST /organizations ([#477](https://github.com/nikunjmavani/core-be/issues/477)) ([dd9fd62](https://github.com/nikunjmavani/core-be/commit/dd9fd62112aefe4eaa63869ab6c37ac62ee8540c))
* **tenancy:** sec-new-T2 validate invitationId path param in all invitation handlers ([#480](https://github.com/nikunjmavani/core-be/issues/480)) ([93fa940](https://github.com/nikunjmavani/core-be/commit/93fa940a7d371acd95889257b027075d305d1e60))
* **tenancy:** sec-new-T3 validate id and roleId path params in role handlers ([#481](https://github.com/nikunjmavani/core-be/issues/481)) ([361159a](https://github.com/nikunjmavani/core-be/commit/361159aca4126ae5df7b446dd437c199082a9636))
* **tests:** cleanupDatabase preserves schema_migrations; update tests inherited from main's B4 + sec-r4-A1 semantics ([#525](https://github.com/nikunjmavani/core-be/issues/525)) ([169327e](https://github.com/nikunjmavani/core-be/commit/169327ec7652cefd7301b8d0c1c47009caa9ae5e))
* **upload:** add DTO-level fileSize ceiling (sec-r4-I4) ([#515](https://github.com/nikunjmavani/core-be/issues/515)) ([049f917](https://github.com/nikunjmavani/core-be/commit/049f917c71b8c043e39bbbcd40f93eec534994fc))
* **user-data-export:** bound offboarding S3 delete fan-out (sec-r4-R2) ([#513](https://github.com/nikunjmavani/core-be/issues/513)) ([6ef83de](https://github.com/nikunjmavani/core-be/commit/6ef83de5039fcb08bd4422ad04cfc4282ee53bd4))
* **user:** rate-limit /me profile mutation endpoints (sec-r4-I1) ([#503](https://github.com/nikunjmavani/core-be/issues/503)) ([0c745e1](https://github.com/nikunjmavani/core-be/commit/0c745e182c0c6be2de608f42e9c434212ad07c08))
* **user:** sec-new-U1 cap ListUsersDto.after cursor to 512 chars ([#483](https://github.com/nikunjmavani/core-be/issues/483)) ([fae555d](https://github.com/nikunjmavani/core-be/commit/fae555dd2717a4cde9a703f64941cca09d55e33f))


### Changed

* **architecture:** move raw SQL out of stripe-webhook-organization.util into the repository (+ global gate) ([#530](https://github.com/nikunjmavani/core-be/issues/530)) ([f48fb46](https://github.com/nikunjmavani/core-be/commit/f48fb46fe1005a95adc0abf14222df8f86c030f9))


### Documentation

* **infra:** annotate Dockerfile build-stage ENV as test-only placeholders (sec-r4-C6) ([#519](https://github.com/nikunjmavani/core-be/issues/519)) ([cdf76ef](https://github.com/nikunjmavani/core-be/commit/cdf76ef7e6a85de7e638c161d1e7ad34dd12e38a))
* **reviews:** architecture conformance audit + 8-PR follow-up plan ([#531](https://github.com/nikunjmavani/core-be/issues/531)) ([4a9264c](https://github.com/nikunjmavani/core-be/commit/4a9264cb674f57930241a8b348d12afdcc727476))
* **reviews:** correct sec-r4-A3 analysis and defer to follow-up task ([#523](https://github.com/nikunjmavani/core-be/issues/523)) ([c7e1dab](https://github.com/nikunjmavani/core-be/commit/c7e1dab9433b40eb16a7df6e28fdf317df9318b7))
* **reviews:** route-coverage audit — 129 routes, 9 deferred gaps allowlisted ([#534](https://github.com/nikunjmavani/core-be/issues/534)) ([d18ec1d](https://github.com/nikunjmavani/core-be/commit/d18ec1df87b78237c77bac6f84b1ec464ff71965))
* **superpowers:** re-audit remediation design spec for 18 findings ([#451](https://github.com/nikunjmavani/core-be/issues/451)) ([1b05734](https://github.com/nikunjmavani/core-be/commit/1b05734fe69e593ae6ad9f5fb2f11e6f4a8f69f6))

## [4.0.0](https://github.com/nikunjmavani/core-be/compare/v3.0.0...v4.0.0) (2026-06-05)


### ⚠ BREAKING CHANGES

* **error-handler:** honor 4xx Fastify framework errors + DoS hardening tests ([#276](https://github.com/nikunjmavani/core-be/issues/276))

### Added

* add environment-managed Railway and Postman secrets ([#77](https://github.com/nikunjmavani/core-be/issues/77)) ([339eee6](https://github.com/nikunjmavani/core-be/commit/339eee628862b20fa1474537526736e37449ebf1))
* **ci:** add PR-time Trivy IaC misconfig scan ([#388](https://github.com/nikunjmavani/core-be/issues/388)) ([e8499e0](https://github.com/nikunjmavani/core-be/commit/e8499e04b8c8d311a14fb6ac3bdd1c4a4d151a49))
* **ci:** auto-merge release-please PRs ([#57](https://github.com/nikunjmavani/core-be/issues/57)) ([30204d8](https://github.com/nikunjmavani/core-be/commit/30204d8d3ee02f8e20b2b3969e80519d3e50ced1))
* **ci:** wire route-HTTP-coverage gate + close mcp/ops gaps (H1) ([#306](https://github.com/nikunjmavani/core-be/issues/306)) ([ef6eefb](https://github.com/nikunjmavani/core-be/commit/ef6eefbc6c311aecec5b9532d2700a48d705654c))
* **coverage:** add patch (differential) coverage tool + document the real coverage policy ([#266](https://github.com/nikunjmavani/core-be/issues/266)) ([73ccfe3](https://github.com/nikunjmavani/core-be/commit/73ccfe3ffd107fc273479d08c76f05a14ec7e73f))
* **env, ci:** Railway deploy secrets in env schema + Node 24 workflow policy bumps ([#75](https://github.com/nikunjmavani/core-be/issues/75)) ([fe7d7eb](https://github.com/nikunjmavani/core-be/commit/fe7d7eb9c28dc885872ed6b202b12a6f51e48158))
* **load:** per-VU credential pool + realistic user-journey k6 scenario ([#342](https://github.com/nikunjmavani/core-be/issues/342)) ([a05a611](https://github.com/nikunjmavani/core-be/commit/a05a611ced68683c0855c65d572fbc5fc7d06bb1))
* **observability:** emit Server-Timing header for true server-side latency ([#339](https://github.com/nikunjmavani/core-be/issues/339)) ([5e78cde](https://github.com/nikunjmavani/core-be/commit/5e78cde15b30deac077cbf4e27081cf6da27e814))
* **outbound:** centralize timeout, retry, circuit, redaction, request-id ([#39](https://github.com/nikunjmavani/core-be/issues/39)) ([ce65bc1](https://github.com/nikunjmavani/core-be/commit/ce65bc14bce3749b952a61d2ddaea600ab29b556))
* production readiness items 3-8 (idempotency, rate-limit obs, sunset CI, restore drill, SBOM, ops scripts) ([#180](https://github.com/nikunjmavani/core-be/issues/180)) ([77792e6](https://github.com/nikunjmavani/core-be/commit/77792e632ea826dd369a1f3abb5d6d1d27e9c718))
* **reliability:** crash-safe dispatch, DLQ auto-retry, and ops improvements ([#214](https://github.com/nikunjmavani/core-be/issues/214)) ([ffdff4d](https://github.com/nikunjmavani/core-be/commit/ffdff4d0eaade870eb50198e0afdb769d72917df))
* **seed:** configurable bulk seeder (shared orchestrator + per-domain seed/ dirs) ([#227](https://github.com/nikunjmavani/core-be/issues/227)) ([d7285a1](https://github.com/nikunjmavani/core-be/commit/d7285a19cd9f29c05092903139156916da29a7c4))
* **seed:** orchestration wiring smoke test + docs/skills/rules ([#238](https://github.com/nikunjmavani/core-be/issues/238)) ([09ee7ef](https://github.com/nikunjmavani/core-be/commit/09ee7ef517075142e587838da5c0df6110504eaa))
* **setup-domain:** rename to setup:domain, fix imports, add poll + batch + runbook ([#153](https://github.com/nikunjmavani/core-be/issues/153)) ([f6b2a10](https://github.com/nikunjmavani/core-be/commit/f6b2a10a16fd827828571e1823584a8c5bfba053))
* **setup-railway:** support RAILWAY_API_TOKEN + mint per-environment project tokens ([#269](https://github.com/nikunjmavani/core-be/issues/269)) ([f73d0dc](https://github.com/nikunjmavani/core-be/commit/f73d0dc4b42667e50a7605637ace43060e661b38))
* **setup:** dynamic rate-limit-aware delay for GitHub env sync + Railway preflight log tweak ([#86](https://github.com/nikunjmavani/core-be/issues/86)) ([7276574](https://github.com/nikunjmavani/core-be/commit/72765742f50a7ee386e5a2cd780edbc6e54dca0c))
* **setup:** harden GitHub env sync and Railway deploy diagnostics ([#88](https://github.com/nikunjmavani/core-be/issues/88)) ([040bfa9](https://github.com/nikunjmavani/core-be/commit/040bfa9919819b3b836e1070a5e4d390da7636cb))
* **setup:** provision Railway Redis with concrete URLs ([#108](https://github.com/nikunjmavani/core-be/issues/108)) ([f2228ca](https://github.com/nikunjmavani/core-be/commit/f2228ca8ebdb44553ca48f59db8cafa7574951e9))
* **sonar:** local SonarQube pre-push quality gate ([#253](https://github.com/nikunjmavani/core-be/issues/253)) ([383ef5e](https://github.com/nikunjmavani/core-be/commit/383ef5e8b0701218e8f020dc534d258df3886279))
* **tooling:** centralize project identity in setup.config.json ([#200](https://github.com/nikunjmavani/core-be/issues/200)) ([c313290](https://github.com/nikunjmavani/core-be/commit/c313290101b3fc845389fd77ac6fefa117f5b168))
* **upload:** confirmation route ([#6](https://github.com/nikunjmavani/core-be/issues/6)) + presigned POST size enforcement ([#7](https://github.com/nikunjmavani/core-be/issues/7)) ([#19](https://github.com/nikunjmavani/core-be/issues/19)) ([236a036](https://github.com/nikunjmavani/core-be/commit/236a036ee4626229128c6be82b85fe7e866a3667))
* **upload:** hardening — filename extension, PENDING sweeper, per-user quota, S3 adapter contract test ([#28](https://github.com/nikunjmavani/core-be/issues/28)) ([bddb789](https://github.com/nikunjmavani/core-be/commit/bddb78904e286d3fcab00692e921d635b0676bac))
* **upload:** reject path-traversal / control-char filenames + upload attack tests ([#279](https://github.com/nikunjmavani/core-be/issues/279)) ([f26a1a9](https://github.com/nikunjmavani/core-be/commit/f26a1a9dd3f9f4660ab42a4f250f254d5e0b9760))


### Fixed

* add keyset pagination for large lists ([#36](https://github.com/nikunjmavani/core-be/issues/36)) ([35ca54d](https://github.com/nikunjmavani/core-be/commit/35ca54dbfe05e6ddf7cf2259273475f72db58f72))
* align worker connection budget with registered queues ([#30](https://github.com/nikunjmavani/core-be/issues/30)) ([86e927d](https://github.com/nikunjmavani/core-be/commit/86e927d2c8d6d65a857e430a7abc0dc2dc02d21e))
* audit batch2 — WebAuthn typed DTOs, oasdiff SIGSEGV CI workaround ([6e44557](https://github.com/nikunjmavani/core-be/commit/6e4455700f39ed6cc6dee5ca71baf4eaddac49ed))
* **audit-13:** remove dead jobTimeout field from worker options — BullMQ does not enforce it ([#379](https://github.com/nikunjmavani/core-be/issues/379)) ([b393d5e](https://github.com/nikunjmavani/core-be/commit/b393d5e0add3e299de889d023056397a559b5df6))
* **audit:** cursor max-length, DLQ catch, jobTimeout, age-based queue eviction (batch5) ([#375](https://github.com/nikunjmavani/core-be/issues/375)) ([5882436](https://github.com/nikunjmavani/core-be/commit/588243618efe4be76f3b9e1d2b0c2aa851b06930))
* **audit:** MCP caller JWT forwarding and IP-level failed-login counter ([#373](https://github.com/nikunjmavani/core-be/issues/373)) ([ceee226](https://github.com/nikunjmavani/core-be/commit/ceee2269da8c40bb16f1332e56de8028de24b069))
* **audit:** rate limits, User-Agent truncation, webhook HTTPS, CAPTCHA staging (batch4) ([#374](https://github.com/nikunjmavani/core-be/issues/374)) ([4c9486a](https://github.com/nikunjmavani/core-be/commit/4c9486ac64959cea4bd308cb59c37ba858018066))
* **auth:** atomically increment the failed-login counter (close lost-update race) ([#303](https://github.com/nikunjmavani/core-be/issues/303)) ([53147a6](https://github.com/nikunjmavani/core-be/commit/53147a65bb78c68ed9e0a94ff2955ca5d21604ee))
* **auth:** email verification fail-closed + remediation tracker ([#188](https://github.com/nikunjmavani/core-be/issues/188)) ([e1dcac5](https://github.com/nikunjmavani/core-be/commit/e1dcac58aca03c5aa66bceb0ab93f4e6e43fed75))
* **auth:** make password reset atomic (transaction) so sessions can't survive it ([#319](https://github.com/nikunjmavani/core-be/issues/319)) ([30cffe5](https://github.com/nikunjmavani/core-be/commit/30cffe5c205fdd7d0f1a835cf335791ad78ad36e))
* **auth:** map duplicate passkey registration to 409 instead of 500 ([#295](https://github.com/nikunjmavani/core-be/issues/295)) ([66b4e1a](https://github.com/nikunjmavani/core-be/commit/66b4e1aa52e3fe59af283b777f8b486d89dce1a2))
* **auth:** remove silent params.id fallback in requireOrganizationPermission ([#346](https://github.com/nikunjmavani/core-be/issues/346)) ([17f4d83](https://github.com/nikunjmavani/core-be/commit/17f4d83fae5114820bf4f1c00940306628ea1228))
* **auth:** restore org-mandated MFA under FORCE RLS via SECURITY DEFINER resolvers ([#318](https://github.com/nikunjmavani/core-be/issues/318)) ([e152c0c](https://github.com/nikunjmavani/core-be/commit/e152c0c458aed788289c7d75b3e8fe0c79ec938f))
* **auth:** stop GET /auth/me/auth-methods leaking encrypted TOTP secret + PII ([#321](https://github.com/nikunjmavani/core-be/issues/321)) ([32cb49e](https://github.com/nikunjmavani/core-be/commit/32cb49e7b1c2039c2554adc481c2f68837720e6e))
* **auth:** stop GET /auth/me/sessions leaking session token hashes ([#287](https://github.com/nikunjmavani/core-be/issues/287)) ([877fe63](https://github.com/nikunjmavani/core-be/commit/877fe63dca1f43a046ad68910df0beba73530ded))
* **billing:** correct misleading plan route OpenAPI descriptions ([#349](https://github.com/nikunjmavani/core-be/issues/349)) ([27246ce](https://github.com/nikunjmavani/core-be/commit/27246ce78082f134005ac028852c7d95233f3c8b))
* **billing:** make Stripe customer creation idempotent on retry ([#326](https://github.com/nikunjmavani/core-be/issues/326)) ([8990fb3](https://github.com/nikunjmavani/core-be/commit/8990fb32b15fa133aece4ce428182d9b1996ee93))
* **billing:** pin Stripe API version to 2026-05-27.dahlia ([#350](https://github.com/nikunjmavani/core-be/issues/350)) ([7c329bd](https://github.com/nikunjmavani/core-be/commit/7c329bd496bdff587f3c12748f923a2ef7267909))
* **cache:** add commandTimeout to Redis client to prevent hung commands ([8cd8107](https://github.com/nikunjmavani/core-be/commit/8cd8107df573d5a8255911dc2fac8f21e676fb66))
* **ci:** align post-deploy checks to /health contract ([#103](https://github.com/nikunjmavani/core-be/issues/103)) ([c7e7728](https://github.com/nikunjmavani/core-be/commit/c7e7728ca3c995323b82a35e753ebd1bf9fec338))
* **ci:** authenticate Railway project tokens in image deploy tool ([#100](https://github.com/nikunjmavani/core-be/issues/100)) ([6ebfd13](https://github.com/nikunjmavani/core-be/commit/6ebfd13d632c39b146fe0767d104acc204cd7846))
* **ci:** batch Railway env push, retry timeouts, exclude all RAILWAY_* ([#92](https://github.com/nikunjmavani/core-be/issues/92)) ([f27128e](https://github.com/nikunjmavani/core-be/commit/f27128e182d995767c630a9b0dfcf634fc7a0cc1))
* **ci:** bootstrap initial Railway deployments when redeploy has no history ([#94](https://github.com/nikunjmavani/core-be/issues/94)) ([61eb364](https://github.com/nikunjmavani/core-be/commit/61eb364e9051b8454cda3ef3124a888a231bf359))
* **ci:** correct post-merge-ci branch context handling ([#53](https://github.com/nikunjmavani/core-be/issues/53)) ([82a359f](https://github.com/nikunjmavani/core-be/commit/82a359f55994f5ce9daf612c2c97c94533290007))
* **ci:** deploy freshly built GHCR image via Railway GraphQL API ([#98](https://github.com/nikunjmavani/core-be/issues/98)) ([fe65954](https://github.com/nikunjmavani/core-be/commit/fe65954aee768faa040bfb08d8535fcf60fc7c59))
* **ci:** drop worker-readiness probe from deploy workflow ([#119](https://github.com/nikunjmavani/core-be/issues/119)) ([57cc48e](https://github.com/nikunjmavani/core-be/commit/57cc48e7cb9815f183a3abf7de2df1646d8648e3))
* **ci:** fail Railway deploy early on invalid RAILWAY_TOKEN ([#79](https://github.com/nikunjmavani/core-be/issues/79)) ([6b5eda1](https://github.com/nikunjmavani/core-be/commit/6b5eda17a2f5f088e8b2850463d5eae3a6071332))
* **ci:** fail-fast on missing Railway deploy secrets ([667bbbe](https://github.com/nikunjmavani/core-be/commit/667bbbe771ec877c890b9da1fc2714e7dbf585f0))
* **ci:** fail-fast on missing Railway deploy secrets ([d10d464](https://github.com/nikunjmavani/core-be/commit/d10d464191786df6a61f83e7898f629e9dba3f2c))
* **ci:** probe worker readiness via Redis instead of public /health ([#117](https://github.com/nikunjmavani/core-be/issues/117)) ([9bc7bb5](https://github.com/nikunjmavani/core-be/commit/9bc7bb5c55305ab75d3317a69fe01708ec52a392))
* **ci:** Railway deploy bootstrap, Docker cache mounts, and CHANGELOG lint ([#96](https://github.com/nikunjmavani/core-be/issues/96)) ([556e75b](https://github.com/nikunjmavani/core-be/commit/556e75b3f2bb4e995b3d7e677168d68476bf12b2))
* **ci:** remove invalid secrets inherit from cd workflow_call ([#48](https://github.com/nikunjmavani/core-be/issues/48)) ([685aa75](https://github.com/nikunjmavani/core-be/commit/685aa75fc66b31d9affb0ffc7adecb7b0b6eccc5))
* **ci:** repair post-merge deploy env wiring ([#56](https://github.com/nikunjmavani/core-be/issues/56)) ([eb59666](https://github.com/nikunjmavani/core-be/commit/eb596666afb9e4c0ac154e0ea3efa0cb76ee8c51))
* **ci:** repair post-merge pipeline failures ([072392e](https://github.com/nikunjmavani/core-be/commit/072392e111af9364076135036ddf53b8c454ba6a))
* **ci:** repair post-merge pipeline failures ([003ffbe](https://github.com/nikunjmavani/core-be/commit/003ffbe44f5721203fcbbb9fc91fe57308e17d5a))
* **ci:** replace invalid env context in post-merge workflow calls ([#50](https://github.com/nikunjmavani/core-be/issues/50)) ([802b772](https://github.com/nikunjmavani/core-be/commit/802b772eca33178319fa33d0857aadd18f1358be))
* **ci:** repoint 12 dead Stryker mutate paths + drift guard (security middlewares were unmutated) ([#310](https://github.com/nikunjmavani/core-be/issues/310)) ([5609146](https://github.com/nikunjmavani/core-be/commit/560914673aa37406be1ecfc570be90d1d6756122))
* **ci:** restore CodeQL tuning lost in [#220](https://github.com/nikunjmavani/core-be/issues/220) squash; unbreak node24 policy ([#221](https://github.com/nikunjmavani/core-be/issues/221)) ([68aec6f](https://github.com/nikunjmavani/core-be/commit/68aec6f4a54572dd082efcdbb08c163b1ec291e7))
* **ci:** run post-merge only on protected branches ([#52](https://github.com/nikunjmavani/core-be/issues/52)) ([3cf2215](https://github.com/nikunjmavani/core-be/commit/3cf2215935c26a3cd48921693f4fb40ed4cb2c90))
* **ci:** share Railway deploy flow and harden GraphQL calls ([#107](https://github.com/nikunjmavani/core-be/issues/107)) ([b11d881](https://github.com/nikunjmavani/core-be/commit/b11d8815cf435938e4ac312fe7c5a5f66a7cad2e))
* **ci:** stabilize post-deploy health probes ([#105](https://github.com/nikunjmavani/core-be/issues/105)) ([e835b35](https://github.com/nikunjmavani/core-be/commit/e835b354f83d063d41e35d157f9d06817cb9e3bd))
* **ci:** stabilize post-merge deploy flow ([#60](https://github.com/nikunjmavani/core-be/issues/60)) ([96fcba3](https://github.com/nikunjmavani/core-be/commit/96fcba3d1ef7c5e3c32b649447ecf97259285ded))
* **ci:** stabilize post-merge flow and pre-push gating ([#54](https://github.com/nikunjmavani/core-be/issues/54)) ([40dc82e](https://github.com/nikunjmavani/core-be/commit/40dc82eca77460e71d7dcbbdabd7a5ef6a2285ff))
* **ci:** unblock dev-&gt;main promotion (PR [#157](https://github.com/nikunjmavani/core-be/issues/157)) ([#222](https://github.com/nikunjmavani/core-be/issues/222)) ([dc0efec](https://github.com/nikunjmavani/core-be/commit/dc0efec1303fd2abf83402698f47881a6368210f))
* **ci:** use bare check-run names as ruleset required-check contexts ([#344](https://github.com/nikunjmavani/core-be/issues/344)) ([c431a63](https://github.com/nikunjmavani/core-be/commit/c431a63a292e9dcff7dc09147c9ae0fd7eb3d5d2))
* **ci:** use fetch-depth: 0 in post-merge changes job to avoid paths-filter race ([#390](https://github.com/nikunjmavani/core-be/issues/390)) ([61a2100](https://github.com/nikunjmavani/core-be/commit/61a210090ae518f75f459cc33806b10ba1442993))
* **ci:** use railway status in deploy token preflight ([#84](https://github.com/nikunjmavani/core-be/issues/84)) ([99d97dd](https://github.com/nikunjmavani/core-be/commit/99d97ddf478991824847ff921c6a587c30deadff))
* **ci:** use supported Railway redeploy command ([#90](https://github.com/nikunjmavani/core-be/issues/90)) ([d7eb03e](https://github.com/nikunjmavani/core-be/commit/d7eb03eec711f4ee7e35839a09c36d231d1c9dd2))
* **database:** fail closed on RLS-bypassing runtime roles ([#164](https://github.com/nikunjmavani/core-be/issues/164)) ([55f13ca](https://github.com/nikunjmavani/core-be/commit/55f13cab619e0341d4085bbe3d0842c16532548c))
* **database:** zero-downtime index migrations via concurrent non-transactional lane (audit [#6](https://github.com/nikunjmavani/core-be/issues/6)) ([#176](https://github.com/nikunjmavani/core-be/issues/176)) ([c38671b](https://github.com/nikunjmavani/core-be/commit/c38671ba372ea2faef593f3806c61b146d4f25d2))
* **db:** correct concurrent unique-violation handling (org-slug race → 500) ([#285](https://github.com/nikunjmavani/core-be/issues/285)) ([8183f71](https://github.com/nikunjmavani/core-be/commit/8183f71fd5096f0be0a793db57770cf76eb99c4f))
* **db:** make audit_logs actor_api_key FK partitioned-table safe ([#225](https://github.com/nikunjmavani/core-be/issues/225)) ([f93c695](https://github.com/nikunjmavani/core-be/commit/f93c6950d5eff54935f79ba7c788e95cc954b3ba))
* document CAPTCHA production guard ([#27](https://github.com/nikunjmavani/core-be/issues/27)) ([d426f1d](https://github.com/nikunjmavani/core-be/commit/d426f1d7235033fa3e5fcde6e56c1178d5ed5544))
* **email-templates:** escape URL fields in invitation and magic-link templates ([#364](https://github.com/nikunjmavani/core-be/issues/364)) ([26c67fa](https://github.com/nikunjmavani/core-be/commit/26c67fac20bff7ccf765c6d93a6264e35ebee079))
* enforce RS256-only JWT policy ([#32](https://github.com/nikunjmavani/core-be/issues/32)) ([293efc1](https://github.com/nikunjmavani/core-be/commit/293efc11157bf1b7cb0c633976b7c5165b8dd0d8))
* **error-handler:** honor 4xx Fastify framework errors + DoS hardening tests ([#276](https://github.com/nikunjmavani/core-be/issues/276)) ([cb21ce4](https://github.com/nikunjmavani/core-be/commit/cb21ce446747b8d66ec8ca45f7d2f2352fd77cde))
* **events:** capture swallowed event-bus errors in Sentry ([2a30d84](https://github.com/nikunjmavani/core-be/commit/2a30d845482dadbe97dd922a4bc54e974105655a))
* **events:** release commit-dispatch marker on rollback (in-memory leak) ([#324](https://github.com/nikunjmavani/core-be/issues/324)) ([7e3ec55](https://github.com/nikunjmavani/core-be/commit/7e3ec559455954d9aeb489e69c4bf416801d76d3))
* **finding-13:** escape title/preheader/footerText inside baseTemplate ([8996b26](https://github.com/nikunjmavani/core-be/commit/8996b2616b52de6f55b0b16315c4a439034e3fba))
* **finding-46:** validate DATABASE_HTTP_STATEMENT_TIMEOUT_MS stays within permission cache lock TTL ([#356](https://github.com/nikunjmavani/core-be/issues/356)) ([47bdab4](https://github.com/nikunjmavani/core-be/commit/47bdab435f83a307cc04f4dc8274f5407aeb8ad3))
* **finding-62:** export WEBHOOK_DELIVERY_JOB_ATTEMPTS and fix vi.mock factories ([#357](https://github.com/nikunjmavani/core-be/issues/357)) ([cd24515](https://github.com/nikunjmavani/core-be/commit/cd24515fa2acf75774da7d636ea42bc0212ec3a2))
* **finding-74:** replace unsafe Stripe object casts with proper type narrowing ([#359](https://github.com/nikunjmavani/core-be/issues/359)) ([f8f9cfe](https://github.com/nikunjmavani/core-be/commit/f8f9cfe8ae24f51ff34c92100dd31b2d1f7745fe))
* gate post-response side effects after commit ([#25](https://github.com/nikunjmavani/core-be/issues/25)) ([1d020f2](https://github.com/nikunjmavani/core-be/commit/1d020f23e42617a6212f1089b738a93ef439d2f7))
* harden observability secret redaction ([#31](https://github.com/nikunjmavani/core-be/issues/31)) ([b293c5c](https://github.com/nikunjmavani/core-be/commit/b293c5c09341224539534f756de4d8bc7179255b))
* include svg sanitizer in runtime dependencies ([1f47aed](https://github.com/nikunjmavani/core-be/commit/1f47aed1b8d84ead3de873531a8199a590f8b33e))
* **infra:** throw on startup when monolithic worker pool demand exceeds DATABASE_POOL_MAX ([faf2fab](https://github.com/nikunjmavani/core-be/commit/faf2fab638f0b77d1ea82dd856d3cefefa893711))
* key global rate limit by IP ([#160](https://github.com/nikunjmavani/core-be/issues/160)) ([c9d8e88](https://github.com/nikunjmavani/core-be/commit/c9d8e88e7fad60ba19c7a9f6a21580682052a939))
* **lockfile:** regenerate pnpm-lock.yaml (merge produced duplicate mapping key) ([c2eba7e](https://github.com/nikunjmavani/core-be/commit/c2eba7eb879f20ee0b5ff182c5edf1ca64715308))
* map remaining unique violations to 409 instead of 500 ([#294](https://github.com/nikunjmavani/core-be/issues/294)) ([7a74b3c](https://github.com/nikunjmavani/core-be/commit/7a74b3c24cbfe90041cb51e3ba5e293110e9039f))
* **mcp:** apply STRICT_AUTHED_RATE_LIMIT to MCP endpoint (audit finding [#7](https://github.com/nikunjmavani/core-be/issues/7)) ([#366](https://github.com/nikunjmavani/core-be/issues/366)) ([6783141](https://github.com/nikunjmavani/core-be/commit/6783141ed14cc7009e1ec2be258386fac1706ed3))
* **migration:** make audit_logs_actor_api_key FK idempotent (unblock dev deploy) ([#385](https://github.com/nikunjmavani/core-be/issues/385)) ([b8cc4fb](https://github.com/nikunjmavani/core-be/commit/b8cc4fb70d3d3d13f31f4b67af35772ff5afdb7e))
* **migration:** make core_be_app least-privilege ALTER ROLE Neon-safe (unblocks all deploys) ([#341](https://github.com/nikunjmavani/core-be/issues/341)) ([488c793](https://github.com/nikunjmavani/core-be/commit/488c793ee93173a2b7d1cedb32879743c3136533))
* **observability:** lazy-load metrics scrape dependencies ([#156](https://github.com/nikunjmavani/core-be/issues/156)) ([9388f34](https://github.com/nikunjmavani/core-be/commit/9388f34e69946da8a092bc189bfb6c796bcf2e18))
* **observability:** track RLS checkout hold time ([#162](https://github.com/nikunjmavani/core-be/issues/162)) ([611cec9](https://github.com/nikunjmavani/core-be/commit/611cec9d9c6fceeb9936f109ee1c5e738aab73d9))
* production audit hardening — upload revocation, auth, billing, notify ([#186](https://github.com/nikunjmavani/core-be/issues/186)) ([3a0f605](https://github.com/nikunjmavani/core-be/commit/3a0f605f77afe6aabf41e307794077063f51b218))
* production hardening — permission RLS resolver, refresh-token reuse detection, billing/notify fail-closed ([#193](https://github.com/nikunjmavani/core-be/issues/193)) ([6d0c8eb](https://github.com/nikunjmavani/core-be/commit/6d0c8eb067cbae422d8d68fcd5a312961f79feae))
* production readiness findings 1–6 (audit, export, billing, webhooks) ([#207](https://github.com/nikunjmavani/core-be/issues/207)) ([7a3094b](https://github.com/nikunjmavani/core-be/commit/7a3094bc85004e51be9d90422df3d1cf124182b4))
* production-readiness audit remediation — auth/RLS, billing, queue/DLQ, uploads, security hardening ([#182](https://github.com/nikunjmavani/core-be/issues/182)) ([91ea552](https://github.com/nikunjmavani/core-be/commit/91ea552d25c3312628005d6e0e77e755a67d1d2c))
* production-readiness hardening (audit [#7](https://github.com/nikunjmavani/core-be/issues/7)-[#16](https://github.com/nikunjmavani/core-be/issues/16)) and /health to /livez+/readyz ([#178](https://github.com/nikunjmavani/core-be/issues/178)) ([146155b](https://github.com/nikunjmavani/core-be/commit/146155b39085e9be3bd96295f5c0e7bba720c9b7))
* **queue:** bound audit.dead_letter_jobs growth via the audit-retention purge ([#322](https://github.com/nikunjmavani/core-be/issues/322)) ([06e729d](https://github.com/nikunjmavani/core-be/commit/06e729ddba34ce6d47ac3f2f7d73ad54910800a2))
* **queue:** preserve rediss TLS for BullMQ Redis options ([#102](https://github.com/nikunjmavani/core-be/issues/102)) ([037c8f5](https://github.com/nikunjmavani/core-be/commit/037c8f52cdaa91c1c49b46de03e221fa7839f012))
* **queue:** stop DLQ auto-retry starvation via a resolved marker on exhausted rows ([#330](https://github.com/nikunjmavani/core-be/issues/330)) ([86c3817](https://github.com/nikunjmavani/core-be/commit/86c381769b50262e30687506b0c9ebeec9a739d9))
* **redis:** use IPv6 dual-stack and drop TLS for Railway private network ([#113](https://github.com/nikunjmavani/core-be/issues/113)) ([00dd3d6](https://github.com/nikunjmavani/core-be/commit/00dd3d6a9d3fa5f3217002bc603758efcfda67fe))
* reduce agent system drift in skills, rules, and docs ([#205](https://github.com/nikunjmavani/core-be/issues/205)) ([2f570a0](https://github.com/nikunjmavani/core-be/commit/2f570a028946e3664e5794bf9cd79b306bd82f74))
* regression residual findings P2–P5 (export, audit, lint) ([#212](https://github.com/nikunjmavani/core-be/issues/212)) ([69a02f2](https://github.com/nikunjmavani/core-be/commit/69a02f24627c009b8b3baedb3eb44b4dc7a9c719))
* **reliability:** complete audit findings 5 and 14 ([#189](https://github.com/nikunjmavani/core-be/issues/189)) ([995325f](https://github.com/nikunjmavani/core-be/commit/995325f41ed89a3dad42137795da22d76908d44d))
* **reliability:** fail-open global rate limiter on Redis store error ([#165](https://github.com/nikunjmavani/core-be/issues/165)) ([f7b189c](https://github.com/nikunjmavani/core-be/commit/f7b189c2a3129f2d6d2e76878abef8acf6b5bb5d))
* require measured DR restore RTO ([#29](https://github.com/nikunjmavani/core-be/issues/29)) ([91c01ec](https://github.com/nikunjmavani/core-be/commit/91c01ec32b018af02141b44e53cfd3de63c563c9))
* resolve major production-hardening issues (13 of 16 + partial [#2](https://github.com/nikunjmavani/core-be/issues/2)) ([#17](https://github.com/nikunjmavani/core-be/issues/17)) ([c0c6620](https://github.com/nikunjmavani/core-be/commit/c0c6620098af677bb6e49418d8aef485238beaf3))
* **rls:** pin core_be_app to NOSUPERUSER/NOBYPASSRLS + assert RLS-binding ([#334](https://github.com/nikunjmavani/core-be/issues/334)) ([18f8b9a](https://github.com/nikunjmavani/core-be/commit/18f8b9aa6f0ae44d45208dabf270a6c5a52c60ec))
* security and stability audit findings (2, 4, 5, 8, 10) ([#199](https://github.com/nikunjmavani/core-be/issues/199)) ([b5c7d1b](https://github.com/nikunjmavani/core-be/commit/b5c7d1b24398d4ca35988be07067813b0ef9929f))
* security hardening follow-up fixes ([#218](https://github.com/nikunjmavani/core-be/issues/218)) ([b3a27e0](https://github.com/nikunjmavani/core-be/commit/b3a27e0f31561681a4f9891d7b9cd24e4274cba6))
* **security:** add maxItems array bounds and fix WebAuthn type casts ([#363](https://github.com/nikunjmavani/core-be/issues/363)) ([ab4e7c7](https://github.com/nikunjmavani/core-be/commit/ab4e7c7c6fb65f374c458b18ef7b8b5927b0e77d))
* **security:** audit remediation — 30 findings + 10 critical fixes ([#196](https://github.com/nikunjmavani/core-be/issues/196)) ([d8d1172](https://github.com/nikunjmavani/core-be/commit/d8d11724d7769ab8076ec42fba8e13525435f36b))
* **security:** production audit hardening — idempotency, auth escalation, RLS, and queue reliability ([#184](https://github.com/nikunjmavani/core-be/issues/184)) ([e8004b3](https://github.com/nikunjmavani/core-be/commit/e8004b3425dcde8c9bbc5d6e839cc63619a0c9d8))
* **security:** reject JWT tokens with unknown kid when keyring is active ([#347](https://github.com/nikunjmavani/core-be/issues/347)) ([2bedfa1](https://github.com/nikunjmavani/core-be/commit/2bedfa1fc7bfe30ebe07e3529cfe8b7c8c78a15d))
* **security:** require explicit wildcard prefix for webhook allowlist subdomain matching ([8d79c89](https://github.com/nikunjmavani/core-be/commit/8d79c891b2a88a8a44cca1420535cfcc6a567a12))
* **security:** require trust proxy hop count ([#168](https://github.com/nikunjmavani/core-be/issues/168)) ([5b0e4c8](https://github.com/nikunjmavani/core-be/commit/5b0e4c81acb644601b6a4fe45a467d3a3fb8c9b8))
* **security:** residual-findings remediation (auth principal, idempotency, audit, upload, degraded-mode) ([#219](https://github.com/nikunjmavani/core-be/issues/219)) ([cddfb4b](https://github.com/nikunjmavani/core-be/commit/cddfb4b251f5247346156c46c458a2b0a2d160f5))
* **security:** strip privileged headers from MCP call_api and remove unversioned aliases ([#348](https://github.com/nikunjmavani/core-be/issues/348)) ([cdaf9ce](https://github.com/nikunjmavani/core-be/commit/cdaf9cef188e146b090bf411dc21e803c53ddea7))
* **setup-infra:** Neon branch/role separation + pnpm 11 upgrade ([#150](https://github.com/nikunjmavani/core-be/issues/150)) ([2fe3515](https://github.com/nikunjmavani/core-be/commit/2fe35157bf2ee417128e6de418de0a3b15ec0308))
* **setup-neon:** create runtime role via SQL to avoid Neon's implicit BYPASSRLS ([#267](https://github.com/nikunjmavani/core-be/issues/267)) ([29b9d77](https://github.com/nikunjmavani/core-be/commit/29b9d77d1176ee0cd304277d80359e94a827a1e2))
* **setup:infra:** switch Railway Redis to template + stop GitHub env duplicates ([#115](https://github.com/nikunjmavani/core-be/issues/115)) ([ee57292](https://github.com/nikunjmavani/core-be/commit/ee572922ea4961e951a6917610665d66ec1b4aa8))
* **sonar:** add localeCompare compare fn to Array.sort() on strings (S2871) ([#230](https://github.com/nikunjmavani/core-be/issues/230)) ([1060614](https://github.com/nikunjmavani/core-be/commit/106061468e94c46bbd91adee85996259d5ea3047))
* **sonar:** group regex alternation for explicit precedence (S5850) ([#229](https://github.com/nikunjmavani/core-be/issues/229)) ([8d74a5e](https://github.com/nikunjmavani/core-be/commit/8d74a5ea8f715b6db79d77b4af99ef8bdccd750e))
* **sonar:** harden auth-header regexes + URL-based Redis redaction (S5852) ([#235](https://github.com/nikunjmavani/core-be/issues/235)) ([ee8ae73](https://github.com/nikunjmavani/core-be/commit/ee8ae7399ce9622317733dfd9032b1569a227192))
* **sonar:** make issueMagicLinkIfUserExists return void (S3516) ([#247](https://github.com/nikunjmavani/core-be/issues/247)) ([96c05c8](https://github.com/nikunjmavani/core-be/commit/96c05c8f9d1209e64f63b58a376a6d0796e69933))
* **sonar:** migrate response encryption to AES-256-GCM (S5542) ([#232](https://github.com/nikunjmavani/core-be/issues/232)) ([7b55853](https://github.com/nikunjmavani/core-be/commit/7b558530aa0f36dea375437079f63cb4596b5329))
* **sonar:** un-nest ternaries + drop redundant cast introduced by [#245](https://github.com/nikunjmavani/core-be/issues/245) ([#246](https://github.com/nikunjmavani/core-be/issues/246)) ([f604a08](https://github.com/nikunjmavani/core-be/commit/f604a08ab2fef5cdbdeac1fa234006437a9e7a4d))
* **sonar:** use crypto.randomInt for jitter/shard selection (S2245) ([#234](https://github.com/nikunjmavani/core-be/issues/234)) ([d586f23](https://github.com/nikunjmavani/core-be/commit/d586f2378b4085889d7025f5476790e6c90adb69))
* **stripe:** tighten webhook replay window to 150 s (audit finding [#6](https://github.com/nikunjmavani/core-be/issues/6)) ([#365](https://github.com/nikunjmavani/core-be/issues/365)) ([848360d](https://github.com/nikunjmavani/core-be/commit/848360d739857212d1822c6e9e4564498649b5c3))
* support scoped RLS contexts ([#26](https://github.com/nikunjmavani/core-be/issues/26)) ([5ecd60c](https://github.com/nikunjmavani/core-be/commit/5ecd60c4f81d38fd6523200ad84d02ea68ce7ed0))
* **tenancy:** emit public ids (not internal bigserial ids) in membership responses ([#329](https://github.com/nikunjmavani/core-be/issues/329)) ([3aac2ac](https://github.com/nikunjmavani/core-be/commit/3aac2ac13d072c1f41bf71bd296468de63d73b3c))
* **tenancy:** make API-key rotation atomic against concurrent rotations ([#307](https://github.com/nikunjmavani/core-be/issues/307)) ([dc0aaa3](https://github.com/nikunjmavani/core-be/commit/dc0aaa326109b5acaeafbe7b7be5f8c5573cd01e))
* **tenancy:** make ownership transfer atomic against a concurrent suspend (TOCTOU) ([#304](https://github.com/nikunjmavani/core-be/issues/304)) ([b6a44b1](https://github.com/nikunjmavani/core-be/commit/b6a44b1e4d9f8eb9a0ecc262c8e5bbf227fb6f4f))
* **tenancy:** map concurrent org slug-update collision to 409 instead of 500 ([#302](https://github.com/nikunjmavani/core-be/issues/302)) ([b8bd666](https://github.com/nikunjmavani/core-be/commit/b8bd666a065cfe8a6ca786c3dd4c95340c72061d))
* **tenancy:** map duplicate role name to 409 instead of 500 ([#292](https://github.com/nikunjmavani/core-be/issues/292)) ([e1a72b3](https://github.com/nikunjmavani/core-be/commit/e1a72b3287103165df7c0eaf32bf9c2f081d45d0))
* **tenancy:** never soft-delete the organization owner's membership (close orphan race) ([#305](https://github.com/nikunjmavani/core-be/issues/305)) ([0262116](https://github.com/nikunjmavani/core-be/commit/026211696fed6522832cd4c04d939d28c3c108ca))
* **tenancy:** reject direct ACTIVE membership create with 403 instead of 500 ([#298](https://github.com/nikunjmavani/core-be/issues/298)) ([dbb8197](https://github.com/nikunjmavani/core-be/commit/dbb819779e766e059a708078d1921c33adfb35e7))
* **test:** enable metrics in test env so local coverage mirrors CI ([#271](https://github.com/nikunjmavani/core-be/issues/271)) ([e0380b6](https://github.com/nikunjmavani/core-be/commit/e0380b655eca210688bf7559fe1fe3e26f53e1ba))
* **test:** make billing mutation + session-revoke integration tests deterministic ([#264](https://github.com/nikunjmavani/core-be/issues/264)) ([d031718](https://github.com/nikunjmavani/core-be/commit/d0317188babbb9c3c788e8ac59613b4a306f230a))
* **tests:** align e2e fixtures with audit batch2 (WebAuthn typed DTO) + Stripe items.period ([#384](https://github.com/nikunjmavani/core-be/issues/384)) ([b906731](https://github.com/nikunjmavani/core-be/commit/b906731f9fdfb6813303c3f25a0ce148a1e2023a))
* **upload:** stop exposing internal storage key + bucket in upload detail ([#288](https://github.com/nikunjmavani/core-be/issues/288)) ([2a3758f](https://github.com/nikunjmavani/core-be/commit/2a3758f42704cbb2bd79d26930340554b0c99737))
* use keyset pagination for large lists ([#35](https://github.com/nikunjmavani/core-be/issues/35)) ([f874a89](https://github.com/nikunjmavani/core-be/commit/f874a89415fe2a2fbbb29d4c09459af781f34f62))
* **user:** reject org-scoped notification preference with 400 (was raw 42501 -&gt; 500) ([#327](https://github.com/nikunjmavani/core-be/issues/327)) ([db1e7a7](https://github.com/nikunjmavani/core-be/commit/db1e7a77e3c8f464bd8354f1235a1f33c5c71967))
* validate notification channel as an enum (422) instead of 500 ([#300](https://github.com/nikunjmavani/core-be/issues/300)) ([a7a50f0](https://github.com/nikunjmavani/core-be/commit/a7a50f09efe961a49ead72bca5def0da94dfefc7))
* validators (audit follow-up) — centralize AES_GCM_IV_LENGTH, allowlist 5 and 512, env-load sunset validator ([#378](https://github.com/nikunjmavani/core-be/issues/378)) ([3bae917](https://github.com/nikunjmavani/core-be/commit/3bae917577c65d11cf771725f81392a0a62ce904))
* webhook SSRF and reliability hardening (9 audit issues) ([#192](https://github.com/nikunjmavani/core-be/issues/192)) ([ae0c0d2](https://github.com/nikunjmavani/core-be/commit/ae0c0d24d60399966a790b7bf526ac3cdc17bb79))


### Performance

* parallelize S3 object deletes in deleteAllExportsForUser ([#361](https://github.com/nikunjmavani/core-be/issues/361)) ([4c36173](https://github.com/nikunjmavani/core-be/commit/4c36173e703bfaa9737ed2a529f0e28e8f863046))


### Changed

* **ci:** align post-merge sequence with release-first flow ([#51](https://github.com/nikunjmavani/core-be/issues/51)) ([4bb98b4](https://github.com/nikunjmavani/core-be/commit/4bb98b42ea4a2c5f9a1ca89d0c5e887eac4ddc1b))
* **ci:** make Railway deploy schema-driven and injection-safe ([#81](https://github.com/nikunjmavani/core-be/issues/81)) ([709c8bb](https://github.com/nikunjmavani/core-be/commit/709c8bb04b23b7df7dfe281301e99ad8087afd35))
* **ci:** rename cd workflow, restrict post-merge to merged PRs, optimize flow ([#49](https://github.com/nikunjmavani/core-be/issues/49)) ([26e49d2](https://github.com/nikunjmavani/core-be/commit/26e49d2d49f52ecddaf14c99df6033bb7e753f8e))
* complete src directory restructure program ([#209](https://github.com/nikunjmavani/core-be/issues/209)) ([d34be1d](https://github.com/nikunjmavani/core-be/commit/d34be1d123e9b1a8325433d8112c8307c8674ca2))
* enforce strict @/ and @tooling/ import paths ([#203](https://github.com/nikunjmavani/core-be/issues/203)) ([09b4bc6](https://github.com/nikunjmavani/core-be/commit/09b4bc6166f6904adce92e20b0ca5abf7d37324d))
* **setup:** redesign setup infra workflow ([#23](https://github.com/nikunjmavani/core-be/issues/23)) ([bb7273f](https://github.com/nikunjmavani/core-be/commit/bb7273f2d9c335b5e201dc7a24cbc4b2238cfaba))
* **sonar:** reduce cognitive complexity of 7 functions (S3776) ([#249](https://github.com/nikunjmavani/core-be/issues/249)) ([1ed41da](https://github.com/nikunjmavani/core-be/commit/1ed41da6232496617897ef977deb3cbeca8d9ace))
* **sonar:** remove redundant WorkerContainers alias (S6564) ([#251](https://github.com/nikunjmavani/core-be/issues/251)) ([4dff585](https://github.com/nikunjmavani/core-be/commit/4dff58590a6b6aef0f08585bc26b93ac51d182b2))
* **user:** route GDPR export through cross-domain services ([#201](https://github.com/nikunjmavani/core-be/issues/201)) ([8428600](https://github.com/nikunjmavani/core-be/commit/84286000a6f1f8573a7171d20936c72f2b1e0c5a))


### Documentation

* add 2026-06-04 deep audit report (20 findings) ([6515589](https://github.com/nikunjmavani/core-be/commit/65155899935406e72781fab5348f146b20b5b8e4))
* add deep backend audit report 2026-06-03 ([#362](https://github.com/nikunjmavani/core-be/issues/362)) ([3d7ae31](https://github.com/nikunjmavani/core-be/commit/3d7ae31779c7975b4b61d19c8f7867c8a58432a9))
* add PR review and intake defaults ([#144](https://github.com/nikunjmavani/core-be/issues/144)) ([fc89a49](https://github.com/nikunjmavani/core-be/commit/fc89a49da75e780ee525ea8b9d9c057b0a1befb2))
* add production readiness audit ([#167](https://github.com/nikunjmavani/core-be/issues/167)) ([baf5e96](https://github.com/nikunjmavani/core-be/commit/baf5e9694400fb55d662d754afc70aca3d293589))
* add production readiness audit ([#171](https://github.com/nikunjmavani/core-be/issues/171)) ([e8fd25f](https://github.com/nikunjmavani/core-be/commit/e8fd25f6288f42999c1637b12f2c767c52df16c0))
* add remediation status tracker to 2026-06-03 audit report ([93ef121](https://github.com/nikunjmavani/core-be/commit/93ef12150cd3917f3a6ecc46c9e8da4573ada94b))
* add Understand Anything learning curve guide ([#172](https://github.com/nikunjmavani/core-be/issues/172)) ([39f8090](https://github.com/nikunjmavani/core-be/commit/39f80907a4cfb1bc97fccf80016ab7a5faee8b8e))
* align OVERVIEWs and security docs with audit hardening behavior ([#197](https://github.com/nikunjmavani/core-be/issues/197)) ([5f28cfb](https://github.com/nikunjmavani/core-be/commit/5f28cfbcfc2bc463da3bb0c1f5ef72fe1ba86f70))
* **audit-2026-06-04:** mark all 20 findings resolved with file:line citations ([#381](https://github.com/nikunjmavani/core-be/issues/381)) ([96dd4f7](https://github.com/nikunjmavani/core-be/commit/96dd4f74574b1dca6ee93190b59edc56ab414b1e))
* **audit:** document audit.logs storage (plain table; hosted partitioning is out-of-band) ([#257](https://github.com/nikunjmavani/core-be/issues/257)) ([26e3f09](https://github.com/nikunjmavani/core-be/commit/26e3f0926e3b280a5ce7a16122b38295509f5c25))
* **audit:** expand AuditService.record JSDoc comment ([#12](https://github.com/nikunjmavani/core-be/issues/12)) ([d01dcf0](https://github.com/nikunjmavani/core-be/commit/d01dcf0157140ae03953e4b4660f465b450ec770))
* clarify CONTRIBUTING intro wording ([#110](https://github.com/nikunjmavani/core-be/issues/110)) ([36dc9e6](https://github.com/nikunjmavani/core-be/commit/36dc9e689179635b37a0d1188d811778873290fc))
* fix stale scripts/dev path in structure-maintainer skill ([#131](https://github.com/nikunjmavani/core-be/issues/131)) ([a787a8a](https://github.com/nikunjmavani/core-be/commit/a787a8a4ac406c4ab0dfaedd62d53a9fe54032af))
* refresh project readme ([#151](https://github.com/nikunjmavani/core-be/issues/151)) ([6a221d3](https://github.com/nikunjmavani/core-be/commit/6a221d3dd69996e176cb20208d3cc746c5fb79f5))
* remove redirect stub docs/index.md (use docs/README.md as canonical index) ([#128](https://github.com/nikunjmavani/core-be/issues/128)) ([2cb1c88](https://github.com/nikunjmavani/core-be/commit/2cb1c88c3e4239da60ae956a445a4ebb31dedf2a))
* **tsdoc:** drive coverage budget to 0/0 ([#148](https://github.com/nikunjmavani/core-be/issues/148)) ([f40408d](https://github.com/nikunjmavani/core-be/commit/f40408d7d58560c67b476e7d5a5db5a94c787780))

## [2.0.0] - 2026-05-16

### BREAKING CHANGES

- **Row-level security (RLS)** organization isolation is enforced at the database layer (`enable_rls`, `notifications_rls` migrations). HTTP requests must flow through tenant middleware so Postgres session variable `app.current_organization_id` is set; **workers and scripts must pass organization identifiers explicitly in queries** — do not rely on RLS session context outside HTTP (see `CLAUDE.md`).

### Security

- **RLS**: Policies enabled across tenancy, auth, billing, notify, audit, and related schemas so row access is scoped by organization where applicable.
- **Notifications RLS**: Notify schema tables participate in organization-scoped RLS.

### Added

- **API keys**: Persistence and domain support for organization API keys (`create_api_keys` migration).
- **Billing domain**: Plans, subscriptions, Stripe customer linkage, and Stripe webhook handling (`add_stripe_customer_id` migration and `src/domains/billing/`).
- **Notify domain**: Notifications and outbound webhooks (`src/domains/notify/`).
- **Audit domain**: Audit logging and retention worker (`src/domains/audit/`, including `audit-retention.worker.ts`).
- **Upload domain**: File upload flows (`src/domains/upload/`).
- **Verification tokens**: Schema support for verification-token flows (`create_verification_tokens` migration).

### Changed

- **Permissions**: Reference permission seed migration aligns baseline roles and permissions (`seed_permissions` migration).
- **Webhooks**: Organization-scoped uniqueness for webhook URLs (`webhooks_org_url_unique` migration).
- **Webhooks**: Soft-delete support for webhooks (`webhooks_soft_delete` migration).
- **Organization notification policies**: Soft-delete support (`organization_notification_policies_soft_delete` migration).

## [1.0.0] - 2025-02-18

### Security

- **SSRF protection**: Webhook URLs validated against private IP ranges; blocks localhost, link-local, and internal networks
- **OAuth CSRF protection**: State parameter stored in Redis with 10-min TTL; validated and consumed on callback
- **OAuth timeouts**: All OAuth provider fetch calls use 10s timeout
- **Webhook response truncation**: Test webhook response body truncated to 500 chars to prevent sensitive data leakage
- **Production JWT**: RS256 required in production (JWT_PRIVATE_KEY and JWT_PUBLIC_KEY must be set)
- **Logger redaction**: Added api_key, access_key_id, secret_access_key to Pino redaction paths
- **Seed password**: Demo password from TEST_PASSWORD env or randomly generated (no hardcoded fallback)

### Fixed

- **Worker shutdown**: RSS monitoring interval cleared on worker shutdown to prevent memory leak

### Added

- **File magic bytes**: Utility for validating upload content-type via magic bytes (PNG, JPEG, WebP, PDF)
