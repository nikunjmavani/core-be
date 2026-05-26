# Changelog

## [2.4.1](https://github.com/nikunjmavani/core-be/compare/v2.4.0...v2.4.1) (2026-05-26)


### Fixed

* **ci:** fail Railway deploy early on invalid RAILWAY_TOKEN ([#79](https://github.com/nikunjmavani/core-be/issues/79)) ([6b5eda1](https://github.com/nikunjmavani/core-be/commit/6b5eda17a2f5f088e8b2850463d5eae3a6071332))

## [2.4.0](https://github.com/nikunjmavani/core-be/compare/v2.3.0...v2.4.0) (2026-05-26)


### Added

* add environment-managed Railway and Postman secrets ([#77](https://github.com/nikunjmavani/core-be/issues/77)) ([339eee6](https://github.com/nikunjmavani/core-be/commit/339eee628862b20fa1474537526736e37449ebf1))

## [2.3.0](https://github.com/nikunjmavani/core-be/compare/v2.2.3...v2.3.0) (2026-05-26)


### Added

* **env, ci:** Railway deploy secrets in env schema + Node 24 workflow policy bumps ([#75](https://github.com/nikunjmavani/core-be/issues/75)) ([fe7d7eb](https://github.com/nikunjmavani/core-be/commit/fe7d7eb9c28dc885872ed6b202b12a6f51e48158))

## [2.2.3](https://github.com/nikunjmavani/core-be/compare/v2.2.2...v2.2.3) (2026-05-26)


### Fixed

* **ci:** fail-fast on missing Railway deploy secrets ([d10d464](https://github.com/nikunjmavani/core-be/commit/d10d464191786df6a61f83e7898f629e9dba3f2c))

## [2.2.2](https://github.com/nikunjmavani/core-be/compare/v2.2.1...v2.2.2) (2026-05-26)


### Fixed

* **ci:** repair post-merge pipeline failures ([072392e](https://github.com/nikunjmavani/core-be/commit/072392e111af9364076135036ddf53b8c454ba6a))
* **ci:** repair post-merge pipeline failures ([003ffbe](https://github.com/nikunjmavani/core-be/commit/003ffbe44f5721203fcbbb9fc91fe57308e17d5a))

## [2.2.1](https://github.com/nikunjmavani/core-be/compare/v2.2.0...v2.2.1) (2026-05-26)


### Fixed

* **ci:** stabilize post-merge deploy flow ([#60](https://github.com/nikunjmavani/core-be/issues/60)) ([96fcba3](https://github.com/nikunjmavani/core-be/commit/96fcba3d1ef7c5e3c32b649447ecf97259285ded))

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
