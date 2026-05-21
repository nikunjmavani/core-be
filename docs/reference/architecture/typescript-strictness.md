# TypeScript strictness flags

| Flag | Status in `tsconfig.json` |
| ---- | ------------------------- |
| `strict` | enabled |
| `noImplicitReturns` | enabled |
| `noUncheckedIndexedAccess` | enabled |
| `exactOptionalPropertyTypes` | enabled |

When assigning optional properties, omit keys instead of setting them to `undefined` (use `omitUndefined()` from `@/shared/utils/validation/omit-undefined.util.js` where needed). Run `pnpm typecheck` after changes that touch optional object shapes.
