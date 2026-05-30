---
name: i18n-message-guard
description: When a user-facing message is added or changed in the codebase, ensure it uses a translation key and that the key exists in src/shared/locales/en/. Do not allow raw user-facing strings in errors, success payloads, or error-handler copy.
---

# i18n message guard (core-be)

Run this skill when **any** of the following are created or modified:

- **Error and validation**: `src/shared/errors/*.ts`, `src/shared/middlewares/error-handler.middleware.ts`, any `*.validator.ts` under `src/domains/`
- **Services/controllers that can return messages**: `src/domains/**/*.service.ts`, `src/domains/**/*.controller.ts` when the change touches `throw` statements, return values with `message`, or response payloads
- **Constants that hold user-facing text**: `src/shared/constants/*.ts` (e.g. message constants)
- **Locale files**: `src/shared/locales/**/*.json` when keys are added or renamed

## What to do

### After code change (errors, validators, services, controllers)

1. **If the change introduces or edits a user-facing string** (e.g. in `throw new XError('...')`, `return { message: '...' }`, or constants used in responses):
   - Use a **translation key** (e.g. `errors:notFound`, `success:emailVerified`) and, in the error handler or controller, use `request.t(key, params)`.
   - Add or update the key in **`src/shared/locales/en/errors.json`** or **`src/shared/locales/en/success.json`** (or **common.json**) with the English string.
   - If other locales exist (e.g. `src/shared/locales/es/`), add or update the same key in `src/shared/locales/es/` (and other locales).

2. **If the change introduces a new translation key in code** (e.g. `request.t('errors:newKey')` or `throw new NotFoundError('errors:newKey', ...)`):
   - Ensure **`src/shared/locales/en/`** contains that key. Optionally update other locale files.

### After locale file change

- If a key is **added or renamed** in `src/shared/locales/en/` or `src/shared/locales/es/`:
  - Ensure at least one code path uses that key (error constructor, error handler, or controller with `request.t()`).
- If a key was **removed or renamed**:
  - Ensure no code still references the old key.

## Checklist to enforce

- [ ] No raw user-facing message strings in `throw new AppError(...)`, `throw new ValidationError(...)`, or subclasses (use **messageKey** + **messageParams**).
- [ ] No hardcoded user-facing strings in the error handler’s `detail` or `errors[].message` (use `request.t()` with keys).
- [ ] No `return { message: '...' }` with a raw string from services that reach the client; use **messageKey** and controller-side `request.t()`.
- [ ] Every key used in code exists in **`src/shared/locales/en/`** (and in other locales if they exist).
- [ ] New keys are added to **`src/shared/locales/en/`** first, then to other locales.

## Reference

- **`docs/reference/runtime/internationalization.md`** — i18n conventions and key format (`namespace:key`).
- **`CLAUDE.md`** — Key Patterns bullet on i18n.
