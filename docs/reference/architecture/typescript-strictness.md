# TypeScript strictness flags

| Flag | Status in `tsconfig.json` |
| ---- | ------------------------- |
| `strict` | enabled |
| `noImplicitReturns` | enabled |
| `noUncheckedIndexedAccess` | enabled |
| `exactOptionalPropertyTypes` | enabled |

When assigning optional properties, omit keys instead of setting them to `undefined` (use `omitUndefined()` from `@/shared/utils/validation/omit-undefined.util.js` where needed). Run `pnpm typecheck` after changes that touch optional object shapes.

## TSDoc on every public export

Strictness extends to **documentation**. Every exported symbol in `src/**/*.ts` must carry a TSDoc summary, and service-like (`*.service.ts`, `*.worker.ts`, `*.processor.ts`) and policy-like (`src/shared/constants/*.ts`) exports must additionally carry an `@remarks` block (Algorithm / Failure modes / Side effects / Notes). This is enforced by **[tsdoc-export-guard](../../../.cursor/skills/tsdoc-export-guard/SKILL.md)** and the monotonic ratchet `pnpm features:check:strict`. See [documentation-system.md](./documentation-system.md) for the full layered docs system.
