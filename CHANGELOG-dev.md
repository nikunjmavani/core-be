# Changelog

> Note: Entries below `3.0.0-dev.0` were cut as stable-style `vX.Y.Z` tags
> while the dev channel's `prerelease: true` config was a no-op (manifest
> was seeded without a `-dev.N` suffix). From `3.0.0-dev.0` onward this
> channel publishes proper `vX.Y.Z-dev.N` prereleases; the matching stable
> `vX.Y.Z` tag is cut on `main` when the prerelease cycle is promoted.

## [3.4.0-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.7-dev.0...v3.4.0-dev.0) (2026-05-31)


### Added

* **tooling:** centralize project identity in setup.config.json ([#200](https://github.com/nikunjmavani/core-be/issues/200)) ([c313290](https://github.com/nikunjmavani/core-be/commit/c313290101b3fc845389fd77ac6fefa117f5b168))


### Fixed

* security and stability audit findings (2, 4, 5, 8, 10) ([#199](https://github.com/nikunjmavani/core-be/issues/199)) ([b5c7d1b](https://github.com/nikunjmavani/core-be/commit/b5c7d1b24398d4ca35988be07067813b0ef9929f))


### Changed

* **user:** route GDPR export through cross-domain services ([#201](https://github.com/nikunjmavani/core-be/issues/201)) ([8428600](https://github.com/nikunjmavani/core-be/commit/84286000a6f1f8573a7171d20936c72f2b1e0c5a))

## [3.3.7-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.6-dev.0...v3.3.7-dev.0) (2026-05-31)


### Fixed

* **security:** audit remediation — 30 findings + 10 critical fixes ([#196](https://github.com/nikunjmavani/core-be/issues/196)) ([d8d1172](https://github.com/nikunjmavani/core-be/commit/d8d11724d7769ab8076ec42fba8e13525435f36b))

## [3.3.6-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.5-dev.0...v3.3.6-dev.0) (2026-05-30)


### Fixed

* production hardening — permission RLS resolver, refresh-token reuse detection, billing/notify fail-closed ([#193](https://github.com/nikunjmavani/core-be/issues/193)) ([6d0c8eb](https://github.com/nikunjmavani/core-be/commit/6d0c8eb067cbae422d8d68fcd5a312961f79feae))
* webhook SSRF and reliability hardening (9 audit issues) ([#192](https://github.com/nikunjmavani/core-be/issues/192)) ([ae0c0d2](https://github.com/nikunjmavani/core-be/commit/ae0c0d24d60399966a790b7bf526ac3cdc17bb79))

## [3.3.5-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.4-dev.0...v3.3.5-dev.0) (2026-05-30)


### Fixed

* **reliability:** complete audit findings 5 and 14 ([#189](https://github.com/nikunjmavani/core-be/issues/189)) ([995325f](https://github.com/nikunjmavani/core-be/commit/995325f41ed89a3dad42137795da22d76908d44d))

## [3.3.4-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.3-dev.0...v3.3.4-dev.0) (2026-05-30)


### Fixed

* **auth:** email verification fail-closed + remediation tracker ([#188](https://github.com/nikunjmavani/core-be/issues/188)) ([e1dcac5](https://github.com/nikunjmavani/core-be/commit/e1dcac58aca03c5aa66bceb0ab93f4e6e43fed75))

## [3.3.3-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.2-dev.0...v3.3.3-dev.0) (2026-05-30)


### Fixed

* production audit hardening — upload revocation, auth, billing, notify ([#186](https://github.com/nikunjmavani/core-be/issues/186)) ([3a0f605](https://github.com/nikunjmavani/core-be/commit/3a0f605f77afe6aabf41e307794077063f51b218))

## [3.3.2-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.1-dev.0...v3.3.2-dev.0) (2026-05-30)


### Fixed

* **security:** production audit hardening — idempotency, auth escalation, RLS, and queue reliability ([#184](https://github.com/nikunjmavani/core-be/issues/184)) ([e8004b3](https://github.com/nikunjmavani/core-be/commit/e8004b3425dcde8c9bbc5d6e839cc63619a0c9d8))

## [3.3.1-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.3.0-dev.0...v3.3.1-dev.0) (2026-05-30)


### Fixed

* production-readiness audit remediation — auth/RLS, billing, queue/DLQ, uploads, security hardening ([#182](https://github.com/nikunjmavani/core-be/issues/182)) ([91ea552](https://github.com/nikunjmavani/core-be/commit/91ea552d25c3312628005d6e0e77e755a67d1d2c))

## [3.3.0-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.9-dev.0...v3.3.0-dev.0) (2026-05-29)


### Added

* production readiness items 3-8 (idempotency, rate-limit obs, sunset CI, restore drill, SBOM, ops scripts) ([#180](https://github.com/nikunjmavani/core-be/issues/180)) ([77792e6](https://github.com/nikunjmavani/core-be/commit/77792e632ea826dd369a1f3abb5d6d1d27e9c718))

## [3.2.9-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.8-dev.0...v3.2.9-dev.0) (2026-05-29)


### Fixed

* production-readiness hardening (audit [#7](https://github.com/nikunjmavani/core-be/issues/7)-[#16](https://github.com/nikunjmavani/core-be/issues/16)) and /health to /livez+/readyz ([#178](https://github.com/nikunjmavani/core-be/issues/178)) ([146155b](https://github.com/nikunjmavani/core-be/commit/146155b39085e9be3bd96295f5c0e7bba720c9b7))

## [3.2.8-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.7-dev.0...v3.2.8-dev.0) (2026-05-29)


### Fixed

* **database:** zero-downtime index migrations via concurrent non-transactional lane (audit [#6](https://github.com/nikunjmavani/core-be/issues/6)) ([#176](https://github.com/nikunjmavani/core-be/issues/176)) ([c38671b](https://github.com/nikunjmavani/core-be/commit/c38671ba372ea2faef593f3806c61b146d4f25d2))

## [3.2.7-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.6-dev.0...v3.2.7-dev.0) (2026-05-29)


### Documentation

* add production readiness audit ([#171](https://github.com/nikunjmavani/core-be/issues/171)) ([e8fd25f](https://github.com/nikunjmavani/core-be/commit/e8fd25f6288f42999c1637b12f2c767c52df16c0))
* add Understand Anything learning curve guide ([#172](https://github.com/nikunjmavani/core-be/issues/172)) ([39f8090](https://github.com/nikunjmavani/core-be/commit/39f80907a4cfb1bc97fccf80016ab7a5faee8b8e))

## [3.2.6-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.5-dev.0...v3.2.6-dev.0) (2026-05-29)


### Fixed

* **security:** require trust proxy hop count ([#168](https://github.com/nikunjmavani/core-be/issues/168)) ([5b0e4c8](https://github.com/nikunjmavani/core-be/commit/5b0e4c81acb644601b6a4fe45a467d3a3fb8c9b8))

## [3.2.5-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.4-dev.0...v3.2.5-dev.0) (2026-05-29)


### Documentation

* add production readiness audit ([#167](https://github.com/nikunjmavani/core-be/issues/167)) ([baf5e96](https://github.com/nikunjmavani/core-be/commit/baf5e9694400fb55d662d754afc70aca3d293589))

## [3.2.4-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.3-dev.0...v3.2.4-dev.0) (2026-05-29)


### Fixed

* **database:** fail closed on RLS-bypassing runtime roles ([#164](https://github.com/nikunjmavani/core-be/issues/164)) ([55f13ca](https://github.com/nikunjmavani/core-be/commit/55f13cab619e0341d4085bbe3d0842c16532548c))

## [3.2.3-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.2-dev.0...v3.2.3-dev.0) (2026-05-29)


### Fixed

* **observability:** track RLS checkout hold time ([#162](https://github.com/nikunjmavani/core-be/issues/162)) ([611cec9](https://github.com/nikunjmavani/core-be/commit/611cec9d9c6fceeb9936f109ee1c5e738aab73d9))

## [3.2.2-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.1-dev.0...v3.2.2-dev.0) (2026-05-29)


### Fixed

* key global rate limit by IP ([#160](https://github.com/nikunjmavani/core-be/issues/160)) ([c9d8e88](https://github.com/nikunjmavani/core-be/commit/c9d8e88e7fad60ba19c7a9f6a21580682052a939))

## [3.2.1-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.2.0-dev.0...v3.2.1-dev.0) (2026-05-29)


### Fixed

* **observability:** lazy-load metrics scrape dependencies ([#156](https://github.com/nikunjmavani/core-be/issues/156)) ([9388f34](https://github.com/nikunjmavani/core-be/commit/9388f34e69946da8a092bc189bfb6c796bcf2e18))

## [3.2.0-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.1.5-dev.0...v3.2.0-dev.0) (2026-05-29)


### Added

* **setup-domain:** rename to setup:domain, fix imports, add poll + batch + runbook ([#153](https://github.com/nikunjmavani/core-be/issues/153)) ([f6b2a10](https://github.com/nikunjmavani/core-be/commit/f6b2a10a16fd827828571e1823584a8c5bfba053))

## [3.1.5-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.1.4-dev.0...v3.1.5-dev.0) (2026-05-28)


### Fixed

* **setup-infra:** Neon branch/role separation + pnpm 11 upgrade ([#150](https://github.com/nikunjmavani/core-be/issues/150)) ([2fe3515](https://github.com/nikunjmavani/core-be/commit/2fe35157bf2ee417128e6de418de0a3b15ec0308))


### Documentation

* refresh project readme ([#151](https://github.com/nikunjmavani/core-be/issues/151)) ([6a221d3](https://github.com/nikunjmavani/core-be/commit/6a221d3dd69996e176cb20208d3cc746c5fb79f5))

## [3.1.4-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.1.3-dev.0...v3.1.4-dev.0) (2026-05-28)


### Documentation

* **tsdoc:** drive coverage budget to 0/0 ([#148](https://github.com/nikunjmavani/core-be/issues/148)) ([f40408d](https://github.com/nikunjmavani/core-be/commit/f40408d7d58560c67b476e7d5a5db5a94c787780))

## [3.1.3-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.1.2-dev.0...v3.1.3-dev.0) (2026-05-28)

### Documentation

- add PR review and intake defaults ([#144](https://github.com/nikunjmavani/core-be/issues/144)) ([fc89a49](https://github.com/nikunjmavani/core-be/commit/fc89a49da75e780ee525ea8b9d9c057b0a1befb2))

## [3.1.2-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.1.1-dev.0...v3.1.2-dev.0) (2026-05-28)

### Documentation

- fix stale scripts/dev path in structure-maintainer skill ([#131](https://github.com/nikunjmavani/core-be/issues/131)) ([a787a8a](https://github.com/nikunjmavani/core-be/commit/a787a8a4ac406c4ab0dfaedd62d53a9fe54032af))

## [3.1.1-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.1.0-dev.0...v3.1.1-dev.0) (2026-05-28)

### Documentation

- remove redirect stub docs/index.md (use docs/README.md as canonical index) ([#128](https://github.com/nikunjmavani/core-be/issues/128)) ([2cb1c88](https://github.com/nikunjmavani/core-be/commit/2cb1c88c3e4239da60ae956a445a4ebb31dedf2a))

## [3.1.0-dev.0](https://github.com/nikunjmavani/core-be/compare/v3.0.0-dev.0...v3.1.0-dev.0) (2026-05-27)

### Added

- add environment-managed Railway and Postman secrets ([#77](https://github.com/nikunjmavani/core-be/issues/77)) ([339eee6](https://github.com/nikunjmavani/core-be/commit/339eee628862b20fa1474537526736e37449ebf1))
- **ci:** auto-merge release-please PRs ([#57](https://github.com/nikunjmavani/core-be/issues/57)) ([30204d8](https://github.com/nikunjmavani/core-be/commit/30204d8d3ee02f8e20b2b3969e80519d3e50ced1))
- **env, ci:** Railway deploy secrets in env schema + Node 24 workflow policy bumps ([#75](https://github.com/nikunjmavani/core-be/issues/75)) ([fe7d7eb](https://github.com/nikunjmavani/core-be/commit/fe7d7eb9c28dc885872ed6b202b12a6f51e48158))
- **outbound:** centralize timeout, retry, circuit, redaction, request-id ([#39](https://github.com/nikunjmavani/core-be/issues/39)) ([ce65bc1](https://github.com/nikunjmavani/core-be/commit/ce65bc14bce3749b952a61d2ddaea600ab29b556))
- **setup:** dynamic rate-limit-aware delay for GitHub env sync + Railway preflight log tweak ([#86](https://github.com/nikunjmavani/core-be/issues/86)) ([7276574](https://github.com/nikunjmavani/core-be/commit/72765742f50a7ee386e5a2cd780edbc6e54dca0c))
- **setup:** harden GitHub env sync and Railway deploy diagnostics ([#88](https://github.com/nikunjmavani/core-be/issues/88)) ([040bfa9](https://github.com/nikunjmavani/core-be/commit/040bfa9919819b3b836e1070a5e4d390da7636cb))
- **setup:** provision Railway Redis with concrete URLs ([#108](https://github.com/nikunjmavani/core-be/issues/108)) ([f2228ca](https://github.com/nikunjmavani/core-be/commit/f2228ca8ebdb44553ca48f59db8cafa7574951e9))
- **upload:** confirmation route ([#6](https://github.com/nikunjmavani/core-be/issues/6)) + presigned POST size enforcement ([#7](https://github.com/nikunjmavani/core-be/issues/7)) ([#19](https://github.com/nikunjmavani/core-be/issues/19)) ([236a036](https://github.com/nikunjmavani/core-be/commit/236a036ee4626229128c6be82b85fe7e866a3667))
- **upload:** hardening — filename extension, PENDING sweeper, per-user quota, S3 adapter contract test ([#28](https://github.com/nikunjmavani/core-be/issues/28)) ([bddb789](https://github.com/nikunjmavani/core-be/commit/bddb78904e286d3fcab00692e921d635b0676bac))

### Fixed

- add keyset pagination for large lists ([#36](https://github.com/nikunjmavani/core-be/issues/36)) ([35ca54d](https://github.com/nikunjmavani/core-be/commit/35ca54dbfe05e6ddf7cf2259273475f72db58f72))
- align worker connection budget with registered queues ([#30](https://github.com/nikunjmavani/core-be/issues/30)) ([86e927d](https://github.com/nikunjmavani/core-be/commit/86e927d2c8d6d65a857e430a7abc0dc2dc02d21e))
- **ci:** align post-deploy checks to /health contract ([#103](https://github.com/nikunjmavani/core-be/issues/103)) ([c7e7728](https://github.com/nikunjmavani/core-be/commit/c7e7728ca3c995323b82a35e753ebd1bf9fec338))
- **ci:** authenticate Railway project tokens in image deploy tool ([#100](https://github.com/nikunjmavani/core-be/issues/100)) ([6ebfd13](https://github.com/nikunjmavani/core-be/commit/6ebfd13d632c39b146fe0767d104acc204cd7846))
- **ci:** batch Railway env push, retry timeouts, exclude all RAILWAY_* ([#92](https://github.com/nikunjmavani/core-be/issues/92)) ([f27128e](https://github.com/nikunjmavani/core-be/commit/f27128e182d995767c630a9b0dfcf634fc7a0cc1))
- **ci:** bootstrap initial Railway deployments when redeploy has no history ([#94](https://github.com/nikunjmavani/core-be/issues/94)) ([61eb364](https://github.com/nikunjmavani/core-be/commit/61eb364e9051b8454cda3ef3124a888a231bf359))
- **ci:** correct post-merge-ci branch context handling ([#53](https://github.com/nikunjmavani/core-be/issues/53)) ([82a359f](https://github.com/nikunjmavani/core-be/commit/82a359f55994f5ce9daf612c2c97c94533290007))
- **ci:** deploy freshly built GHCR image via Railway GraphQL API ([#98](https://github.com/nikunjmavani/core-be/issues/98)) ([fe65954](https://github.com/nikunjmavani/core-be/commit/fe65954aee768faa040bfb08d8535fcf60fc7c59))
- **ci:** drop worker-readiness probe from deploy workflow ([#119](https://github.com/nikunjmavani/core-be/issues/119)) ([57cc48e](https://github.com/nikunjmavani/core-be/commit/57cc48e7cb9815f183a3abf7de2df1646d8648e3))
- **ci:** fail Railway deploy early on invalid RAILWAY_TOKEN ([#79](https://github.com/nikunjmavani/core-be/issues/79)) ([6b5eda1](https://github.com/nikunjmavani/core-be/commit/6b5eda17a2f5f088e8b2850463d5eae3a6071332))
- **ci:** fail-fast on missing Railway deploy secrets ([d10d464](https://github.com/nikunjmavani/core-be/commit/d10d464191786df6a61f83e7898f629e9dba3f2c))
- **ci:** probe worker readiness via Redis instead of public /health ([#117](https://github.com/nikunjmavani/core-be/issues/117)) ([9bc7bb5](https://github.com/nikunjmavani/core-be/commit/9bc7bb5c55305ab75d3317a69fe01708ec52a392))
- **ci:** Railway deploy bootstrap, Docker cache mounts, and CHANGELOG lint ([#96](https://github.com/nikunjmavani/core-be/issues/96)) ([556e75b](https://github.com/nikunjmavani/core-be/commit/556e75b3f2bb4e995b3d7e677168d68476bf12b2))
- **ci:** remove invalid secrets inherit from cd workflow_call ([#48](https://github.com/nikunjmavani/core-be/issues/48)) ([685aa75](https://github.com/nikunjmavani/core-be/commit/685aa75fc66b31d9affb0ffc7adecb7b0b6eccc5))
- **ci:** repair post-merge deploy env wiring ([#56](https://github.com/nikunjmavani/core-be/issues/56)) ([eb59666](https://github.com/nikunjmavani/core-be/commit/eb596666afb9e4c0ac154e0ea3efa0cb76ee8c51))
- **ci:** repair post-merge pipeline failures ([072392e](https://github.com/nikunjmavani/core-be/commit/072392e111af9364076135036ddf53b8c454ba6a))
- **ci:** repair post-merge pipeline failures ([003ffbe](https://github.com/nikunjmavani/core-be/commit/003ffbe44f5721203fcbbb9fc91fe57308e17d5a))
- **ci:** replace invalid env context in post-merge workflow calls ([#50](https://github.com/nikunjmavani/core-be/issues/50)) ([802b772](https://github.com/nikunjmavani/core-be/commit/802b772eca33178319fa33d0857aadd18f1358be))
- **ci:** run post-merge only on protected branches ([#52](https://github.com/nikunjmavani/core-be/issues/52)) ([3cf2215](https://github.com/nikunjmavani/core-be/commit/3cf2215935c26a3cd48921693f4fb40ed4cb2c90))
- **ci:** share Railway deploy flow and harden GraphQL calls ([#107](https://github.com/nikunjmavani/core-be/issues/107)) ([b11d881](https://github.com/nikunjmavani/core-be/commit/b11d8815cf435938e4ac312fe7c5a5f66a7cad2e))
- **ci:** stabilize post-deploy health probes ([#105](https://github.com/nikunjmavani/core-be/issues/105)) ([e835b35](https://github.com/nikunjmavani/core-be/commit/e835b354f83d063d41e35d157f9d06817cb9e3bd))
- **ci:** stabilize post-merge deploy flow ([#60](https://github.com/nikunjmavani/core-be/issues/60)) ([96fcba3](https://github.com/nikunjmavani/core-be/commit/96fcba3d1ef7c5e3c32b649447ecf97259285ded))
- **ci:** stabilize post-merge flow and pre-push gating ([#54](https://github.com/nikunjmavani/core-be/issues/54)) ([40dc82e](https://github.com/nikunjmavani/core-be/commit/40dc82eca77460e71d7dcbbdabd7a5ef6a2285ff))
- **ci:** use railway status in deploy token preflight ([#84](https://github.com/nikunjmavani/core-be/issues/84)) ([99d97dd](https://github.com/nikunjmavani/core-be/commit/99d97ddf478991824847ff921c6a587c30deadff))
- **ci:** use supported Railway redeploy command ([#90](https://github.com/nikunjmavani/core-be/issues/90)) ([d7eb03e](https://github.com/nikunjmavani/core-be/commit/d7eb03eec711f4ee7e35839a09c36d231d1c9dd2))
- document CAPTCHA production guard ([#27](https://github.com/nikunjmavani/core-be/issues/27)) ([d426f1d](https://github.com/nikunjmavani/core-be/commit/d426f1d7235033fa3e5fcde6e56c1178d5ed5544))
- enforce RS256-only JWT policy ([#32](https://github.com/nikunjmavani/core-be/issues/32)) ([293efc1](https://github.com/nikunjmavani/core-be/commit/293efc11157bf1b7cb0c633976b7c5165b8dd0d8))
- gate post-response side effects after commit ([#25](https://github.com/nikunjmavani/core-be/issues/25)) ([1d020f2](https://github.com/nikunjmavani/core-be/commit/1d020f23e42617a6212f1089b738a93ef439d2f7))
- harden observability secret redaction ([#31](https://github.com/nikunjmavani/core-be/issues/31)) ([b293c5c](https://github.com/nikunjmavani/core-be/commit/b293c5c09341224539534f756de4d8bc7179255b))
- include svg sanitizer in runtime dependencies ([1f47aed](https://github.com/nikunjmavani/core-be/commit/1f47aed1b8d84ead3de873531a8199a590f8b33e))
- **queue:** preserve rediss TLS for BullMQ Redis options ([#102](https://github.com/nikunjmavani/core-be/issues/102)) ([037c8f5](https://github.com/nikunjmavani/core-be/commit/037c8f52cdaa91c1c49b46de03e221fa7839f012))
- **redis:** use IPv6 dual-stack and drop TLS for Railway private network ([#113](https://github.com/nikunjmavani/core-be/issues/113)) ([00dd3d6](https://github.com/nikunjmavani/core-be/commit/00dd3d6a9d3fa5f3217002bc603758efcfda67fe))
- require measured DR restore RTO ([#29](https://github.com/nikunjmavani/core-be/issues/29)) ([91c01ec](https://github.com/nikunjmavani/core-be/commit/91c01ec32b018af02141b44e53cfd3de63c563c9))
- resolve major production-hardening issues (13 of 16 + partial [#2](https://github.com/nikunjmavani/core-be/issues/2)) ([#17](https://github.com/nikunjmavani/core-be/issues/17)) ([c0c6620](https://github.com/nikunjmavani/core-be/commit/c0c6620098af677bb6e49418d8aef485238beaf3))
- **setup:infra:** switch Railway Redis to template + stop GitHub env duplicates ([#115](https://github.com/nikunjmavani/core-be/issues/115)) ([ee57292](https://github.com/nikunjmavani/core-be/commit/ee572922ea4961e951a6917610665d66ec1b4aa8))
- support scoped RLS contexts ([#26](https://github.com/nikunjmavani/core-be/issues/26)) ([5ecd60c](https://github.com/nikunjmavani/core-be/commit/5ecd60c4f81d38fd6523200ad84d02ea68ce7ed0))
- use keyset pagination for large lists ([#35](https://github.com/nikunjmavani/core-be/issues/35)) ([f874a89](https://github.com/nikunjmavani/core-be/commit/f874a89415fe2a2fbbb29d4c09459af781f34f62))

### Changed

- **ci:** align post-merge sequence with release-first flow ([#51](https://github.com/nikunjmavani/core-be/issues/51)) ([4bb98b4](https://github.com/nikunjmavani/core-be/commit/4bb98b42ea4a2c5f9a1ca89d0c5e887eac4ddc1b))
- **ci:** make Railway deploy schema-driven and injection-safe ([#81](https://github.com/nikunjmavani/core-be/issues/81)) ([709c8bb](https://github.com/nikunjmavani/core-be/commit/709c8bb04b23b7df7dfe281301e99ad8087afd35))
- **ci:** rename cd workflow, restrict post-merge to merged PRs, optimize flow ([#49](https://github.com/nikunjmavani/core-be/issues/49)) ([26e49d2](https://github.com/nikunjmavani/core-be/commit/26e49d2d49f52ecddaf14c99df6033bb7e753f8e))
- **setup:** redesign setup infra workflow ([#23](https://github.com/nikunjmavani/core-be/issues/23)) ([bb7273f](https://github.com/nikunjmavani/core-be/commit/bb7273f2d9c335b5e201dc7a24cbc4b2238cfaba))

### Documentation

- **audit:** expand AuditService.record JSDoc comment ([#12](https://github.com/nikunjmavani/core-be/issues/12)) ([d01dcf0](https://github.com/nikunjmavani/core-be/commit/d01dcf0157140ae03953e4b4660f465b450ec770))
- clarify CONTRIBUTING intro wording ([#110](https://github.com/nikunjmavani/core-be/issues/110)) ([36dc9e6](https://github.com/nikunjmavani/core-be/commit/36dc9e689179635b37a0d1188d811778873290fc))

## [2.7.1](https://github.com/nikunjmavani/core-be/compare/v2.7.0...v2.7.1) (2026-05-27)

### Documentation

- clarify CONTRIBUTING intro wording ([#110](https://github.com/nikunjmavani/core-be/issues/110)) ([36dc9e6](https://github.com/nikunjmavani/core-be/commit/36dc9e689179635b37a0d1188d811778873290fc))

## [2.7.0](https://github.com/nikunjmavani/core-be/compare/v2.6.8...v2.7.0) (2026-05-27)

### Added

- **setup:** provision Railway Redis with concrete URLs ([#108](https://github.com/nikunjmavani/core-be/issues/108)) ([f2228ca](https://github.com/nikunjmavani/core-be/commit/f2228ca8ebdb44553ca48f59db8cafa7574951e9))

### Fixed

- **ci:** share Railway deploy flow and harden GraphQL calls ([#107](https://github.com/nikunjmavani/core-be/issues/107)) ([b11d881](https://github.com/nikunjmavani/core-be/commit/b11d8815cf435938e4ac312fe7c5a5f66a7cad2e))

## [2.6.8](https://github.com/nikunjmavani/core-be/compare/v2.6.7...v2.6.8) (2026-05-27)

### Fixed

- **ci:** stabilize post-deploy health probes ([#105](https://github.com/nikunjmavani/core-be/issues/105)) ([e835b35](https://github.com/nikunjmavani/core-be/commit/e835b354f83d063d41e35d157f9d06817cb9e3bd))

## [2.6.7](https://github.com/nikunjmavani/core-be/compare/v2.6.6...v2.6.7) (2026-05-27)

### Fixed

- **ci:** align post-deploy checks to /health contract ([#103](https://github.com/nikunjmavani/core-be/issues/103)) ([c7e7728](https://github.com/nikunjmavani/core-be/commit/c7e7728ca3c995323b82a35e753ebd1bf9fec338))
- **queue:** preserve rediss TLS for BullMQ Redis options ([#102](https://github.com/nikunjmavani/core-be/issues/102)) ([037c8f5](https://github.com/nikunjmavani/core-be/commit/037c8f52cdaa91c1c49b46de03e221fa7839f012))

## [2.6.6](https://github.com/nikunjmavani/core-be/compare/v2.6.5...v2.6.6) (2026-05-27)

### Fixed

- **ci:** authenticate Railway project tokens in image deploy tool ([#100](https://github.com/nikunjmavani/core-be/issues/100)) ([6ebfd13](https://github.com/nikunjmavani/core-be/commit/6ebfd13d632c39b146fe0767d104acc204cd7846))

## [2.6.5](https://github.com/nikunjmavani/core-be/compare/v2.6.4...v2.6.5) (2026-05-27)

### Fixed

- **ci:** deploy freshly built GHCR image via Railway GraphQL API ([#98](https://github.com/nikunjmavani/core-be/issues/98)) ([fe65954](https://github.com/nikunjmavani/core-be/commit/fe65954aee768faa040bfb08d8535fcf60fc7c59))

## [2.6.4](https://github.com/nikunjmavani/core-be/compare/v2.6.3...v2.6.4) (2026-05-27)

### Fixed

- **ci:** Railway deploy bootstrap, Docker cache mounts, and CHANGELOG lint ([#96](https://github.com/nikunjmavani/core-be/issues/96)) ([556e75b](https://github.com/nikunjmavani/core-be/commit/556e75b3f2bb4e995b3d7e677168d68476bf12b2))

## [2.6.3](https://github.com/nikunjmavani/core-be/compare/v2.6.2...v2.6.3) (2026-05-27)

### Fixed

- **ci:** bootstrap initial Railway deployments when redeploy has no history ([#94](https://github.com/nikunjmavani/core-be/issues/94)) ([61eb364](https://github.com/nikunjmavani/core-be/commit/61eb364e9051b8454cda3ef3124a888a231bf359))

## [2.6.2](https://github.com/nikunjmavani/core-be/compare/v2.6.1...v2.6.2) (2026-05-27)

### Fixed

- **ci:** batch Railway env push, retry timeouts, exclude all RAILWAY_* ([#92](https://github.com/nikunjmavani/core-be/issues/92)) ([f27128e](https://github.com/nikunjmavani/core-be/commit/f27128e182d995767c630a9b0dfcf634fc7a0cc1))

## [2.6.1](https://github.com/nikunjmavani/core-be/compare/v2.6.0...v2.6.1) (2026-05-27)

### Fixed

- **ci:** use supported Railway redeploy command ([#90](https://github.com/nikunjmavani/core-be/issues/90)) ([d7eb03e](https://github.com/nikunjmavani/core-be/commit/d7eb03eec711f4ee7e35839a09c36d231d1c9dd2))

## [2.6.0](https://github.com/nikunjmavani/core-be/compare/v2.5.0...v2.6.0) (2026-05-27)

### Added

- **setup:** harden GitHub env sync and Railway deploy diagnostics ([#88](https://github.com/nikunjmavani/core-be/issues/88)) ([040bfa9](https://github.com/nikunjmavani/core-be/commit/040bfa9919819b3b836e1070a5e4d390da7636cb))

## [2.5.0](https://github.com/nikunjmavani/core-be/compare/v2.4.3...v2.5.0) (2026-05-27)

### Added

- **setup:** dynamic rate-limit-aware delay for GitHub env sync + Railway preflight log tweak ([#86](https://github.com/nikunjmavani/core-be/issues/86)) ([7276574](https://github.com/nikunjmavani/core-be/commit/72765742f50a7ee386e5a2cd780edbc6e54dca0c))

## [2.4.3](https://github.com/nikunjmavani/core-be/compare/v2.4.2...v2.4.3) (2026-05-26)

### Fixed

- **ci:** use railway status in deploy token preflight ([#84](https://github.com/nikunjmavani/core-be/issues/84)) ([99d97dd](https://github.com/nikunjmavani/core-be/commit/99d97ddf478991824847ff921c6a587c30deadff))

## [2.4.2](https://github.com/nikunjmavani/core-be/compare/v2.4.1...v2.4.2) (2026-05-26)

### Changed

- **ci:** make Railway deploy schema-driven and injection-safe ([#81](https://github.com/nikunjmavani/core-be/issues/81)) ([709c8bb](https://github.com/nikunjmavani/core-be/commit/709c8bb04b23b7df7dfe281301e99ad8087afd35))

## [2.4.1](https://github.com/nikunjmavani/core-be/compare/v2.4.0...v2.4.1) (2026-05-26)

### Fixed

- **ci:** fail Railway deploy early on invalid RAILWAY_TOKEN ([#79](https://github.com/nikunjmavani/core-be/issues/79)) ([6b5eda1](https://github.com/nikunjmavani/core-be/commit/6b5eda17a2f5f088e8b2850463d5eae3a6071332))

## [2.4.0](https://github.com/nikunjmavani/core-be/compare/v2.3.0...v2.4.0) (2026-05-26)

### Added

- add environment-managed Railway and Postman secrets ([#77](https://github.com/nikunjmavani/core-be/issues/77)) ([339eee6](https://github.com/nikunjmavani/core-be/commit/339eee628862b20fa1474537526736e37449ebf1))

## [2.3.0](https://github.com/nikunjmavani/core-be/compare/v2.2.3...v2.3.0) (2026-05-26)

### Added

- **env, ci:** Railway deploy secrets in env schema + Node 24 workflow policy bumps ([#75](https://github.com/nikunjmavani/core-be/issues/75)) ([fe7d7eb](https://github.com/nikunjmavani/core-be/commit/fe7d7eb9c28dc885872ed6b202b12a6f51e48158))

## [2.2.3](https://github.com/nikunjmavani/core-be/compare/v2.2.2...v2.2.3) (2026-05-26)

### Fixed

- **ci:** fail-fast on missing Railway deploy secrets ([d10d464](https://github.com/nikunjmavani/core-be/commit/d10d464191786df6a61f83e7898f629e9dba3f2c))

## [2.2.2](https://github.com/nikunjmavani/core-be/compare/v2.2.1...v2.2.2) (2026-05-26)

### Fixed

- **ci:** repair post-merge pipeline failures ([072392e](https://github.com/nikunjmavani/core-be/commit/072392e111af9364076135036ddf53b8c454ba6a))
- **ci:** repair post-merge pipeline failures ([003ffbe](https://github.com/nikunjmavani/core-be/commit/003ffbe44f5721203fcbbb9fc91fe57308e17d5a))

## [2.2.1](https://github.com/nikunjmavani/core-be/compare/v2.2.0...v2.2.1) (2026-05-26)

### Fixed

- **ci:** stabilize post-merge deploy flow ([#60](https://github.com/nikunjmavani/core-be/issues/60)) ([96fcba3](https://github.com/nikunjmavani/core-be/commit/96fcba3d1ef7c5e3c32b649447ecf97259285ded))

## [2.2.0](https://github.com/nikunjmavani/core-be/compare/v2.1.1...v2.2.0) (2026-05-26)

### Added

- **ci:** auto-merge release-please PRs ([#57](https://github.com/nikunjmavani/core-be/issues/57)) ([30204d8](https://github.com/nikunjmavani/core-be/commit/30204d8d3ee02f8e20b2b3969e80519d3e50ced1))

### Fixed

- **ci:** repair post-merge deploy env wiring ([#56](https://github.com/nikunjmavani/core-be/issues/56)) ([eb59666](https://github.com/nikunjmavani/core-be/commit/eb596666afb9e4c0ac154e0ea3efa0cb76ee8c51))

## [2.1.0](https://github.com/nikunjmavani/core-be/compare/v2.0.0...v2.1.0) (2026-05-26)

### Added

- **outbound:** centralize timeout, retry, circuit, redaction, request-id ([#39](https://github.com/nikunjmavani/core-be/issues/39)) ([ce65bc1](https://github.com/nikunjmavani/core-be/commit/ce65bc14bce3749b952a61d2ddaea600ab29b556))
- **upload:** confirmation route ([#6](https://github.com/nikunjmavani/core-be/issues/6)) + presigned POST size enforcement ([#7](https://github.com/nikunjmavani/core-be/issues/7)) ([#19](https://github.com/nikunjmavani/core-be/issues/19)) ([236a036](https://github.com/nikunjmavani/core-be/commit/236a036ee4626229128c6be82b85fe7e866a3667))
- **upload:** hardening — filename extension, PENDING sweeper, per-user quota, S3 adapter contract test ([#28](https://github.com/nikunjmavani/core-be/issues/28)) ([bddb789](https://github.com/nikunjmavani/core-be/commit/bddb78904e286d3fcab00692e921d635b0676bac))

### Fixed

- add keyset pagination for large lists ([#36](https://github.com/nikunjmavani/core-be/issues/36)) ([35ca54d](https://github.com/nikunjmavani/core-be/commit/35ca54dbfe05e6ddf7cf2259273475f72db58f72))
- align worker connection budget with registered queues ([#30](https://github.com/nikunjmavani/core-be/issues/30)) ([86e927d](https://github.com/nikunjmavani/core-be/commit/86e927d2c8d6d65a857e430a7abc0dc2dc02d21e))
- **ci:** correct post-merge-ci branch context handling ([#53](https://github.com/nikunjmavani/core-be/issues/53)) ([82a359f](https://github.com/nikunjmavani/core-be/commit/82a359f55994f5ce9daf612c2c97c94533290007))
- **ci:** remove invalid secrets inherit from cd workflow_call ([#48](https://github.com/nikunjmavani/core-be/issues/48)) ([685aa75](https://github.com/nikunjmavani/core-be/commit/685aa75fc66b31d9affb0ffc7adecb7b0b6eccc5))
- **ci:** replace invalid env context in post-merge workflow calls ([#50](https://github.com/nikunjmavani/core-be/issues/50)) ([802b772](https://github.com/nikunjmavani/core-be/commit/802b772eca33178319fa33d0857aadd18f1358be))
- **ci:** run post-merge only on protected branches ([#52](https://github.com/nikunjmavani/core-be/issues/52)) ([3cf2215](https://github.com/nikunjmavani/core-be/commit/3cf2215935c26a3cd48921693f4fb40ed4cb2c90))
- **ci:** stabilize post-merge flow and pre-push gating ([#54](https://github.com/nikunjmavani/core-be/issues/54)) ([40dc82e](https://github.com/nikunjmavani/core-be/commit/40dc82eca77460e71d7dcbbdabd7a5ef6a2285ff))
- document CAPTCHA production guard ([#27](https://github.com/nikunjmavani/core-be/issues/27)) ([d426f1d](https://github.com/nikunjmavani/core-be/commit/d426f1d7235033fa3e5fcde6e56c1178d5ed5544))
- enforce RS256-only JWT policy ([#32](https://github.com/nikunjmavani/core-be/issues/32)) ([293efc1](https://github.com/nikunjmavani/core-be/commit/293efc11157bf1b7cb0c633976b7c5165b8dd0d8))
- gate post-response side effects after commit ([#25](https://github.com/nikunjmavani/core-be/issues/25)) ([1d020f2](https://github.com/nikunjmavani/core-be/commit/1d020f23e42617a6212f1089b738a93ef439d2f7))
- harden observability secret redaction ([#31](https://github.com/nikunjmavani/core-be/issues/31)) ([b293c5c](https://github.com/nikunjmavani/core-be/commit/b293c5c09341224539534f756de4d8bc7179255b))
- include svg sanitizer in runtime dependencies ([1f47aed](https://github.com/nikunjmavani/core-be/commit/1f47aed1b8d84ead3de873531a8199a590f8b33e))
- require measured DR restore RTO ([#29](https://github.com/nikunjmavani/core-be/issues/29)) ([91c01ec](https://github.com/nikunjmavani/core-be/commit/91c01ec32b018af02141b44e53cfd3de63c563c9))
- resolve major production-hardening issues (13 of 16 + partial [#2](https://github.com/nikunjmavani/core-be/issues/2)) ([#17](https://github.com/nikunjmavani/core-be/issues/17)) ([c0c6620](https://github.com/nikunjmavani/core-be/commit/c0c6620098af677bb6e49418d8aef485238beaf3))
- support scoped RLS contexts ([#26](https://github.com/nikunjmavani/core-be/issues/26)) ([5ecd60c](https://github.com/nikunjmavani/core-be/commit/5ecd60c4f81d38fd6523200ad84d02ea68ce7ed0))
- use keyset pagination for large lists ([#35](https://github.com/nikunjmavani/core-be/issues/35)) ([f874a89](https://github.com/nikunjmavani/core-be/commit/f874a89415fe2a2fbbb29d4c09459af781f34f62))

### Changed

- **ci:** align post-merge sequence with release-first flow ([#51](https://github.com/nikunjmavani/core-be/issues/51)) ([4bb98b4](https://github.com/nikunjmavani/core-be/commit/4bb98b42ea4a2c5f9a1ca89d0c5e887eac4ddc1b))
- **ci:** rename cd workflow, restrict post-merge to merged PRs, optimize flow ([#49](https://github.com/nikunjmavani/core-be/issues/49)) ([26e49d2](https://github.com/nikunjmavani/core-be/commit/26e49d2d49f52ecddaf14c99df6033bb7e753f8e))
- **setup:** redesign setup infra workflow ([#23](https://github.com/nikunjmavani/core-be/issues/23)) ([bb7273f](https://github.com/nikunjmavani/core-be/commit/bb7273f2d9c335b5e201dc7a24cbc4b2238cfaba))

### Documentation

- **audit:** expand AuditService.record JSDoc comment ([#12](https://github.com/nikunjmavani/core-be/issues/12)) ([d01dcf0](https://github.com/nikunjmavani/core-be/commit/d01dcf0157140ae03953e4b4660f465b450ec770))
