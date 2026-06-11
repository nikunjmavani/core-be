import { z } from 'zod';

/**
 * Prototype-pollution-prone keys rejected from the `security_policy` JSONB record (route-audit
 * hardening). The record is stored opaquely today, but blocking these at the edge prevents a
 * future consumer that spreads/merges the policy into a runtime object from being polluted.
 */
const PROTO_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Zod schema for `PATCH /api/v1/organizations/:id/settings`. All fields are
 * optional (PATCH semantics); `default_locale` is constrained to the
 * locales the API actually translates (`en`, `es`); `security_policy` is a
 * bounded free-form record persisted as JSONB — max 50 keys, keys ≤ 100 chars
 * (and never `__proto__`/`constructor`/`prototype`), scalar values only
 * (string ≤ 500, number, boolean, null).
 */
export const updateOrganizationSettingsDto = z
  .object({
    is_email_notifications_enabled: z.boolean().optional(),
    default_locale: z.enum(['en', 'es']).optional(),
    security_policy: z
      .record(
        z.string().min(1).max(100),
        z.union([z.string().max(500), z.number(), z.boolean(), z.null()]),
      )
      .refine((record) => Object.keys(record).length <= 50, 'security_policy: max 50 keys allowed')
      .refine(
        (record) => !Object.keys(record).some((key) => PROTO_POLLUTION_KEYS.has(key)),
        'security_policy: keys __proto__, constructor, and prototype are not allowed',
      )
      .optional(),
  })
  .strict();

/** DTO inferred from {@link updateOrganizationSettingsDto}. */
export type UpdateOrganizationSettingsInput = z.infer<typeof updateOrganizationSettingsDto>;
