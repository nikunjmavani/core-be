/**
 * Free-form feature flags / capability map advertised by a plan tier (the
 * `billing.plans.features` jsonb). REQ-4 surfaces this verbatim in the public
 * plan response; keys are caller-defined capability names mapping to a boolean
 * toggle or a numeric/string limit (e.g. `{ "priority_support": true,
 * "max_projects": 10 }`). The map is intentionally open (`Record`) so adding a
 * feature needs no schema change — only the seed and the frontend agree on keys.
 */
export type PlanFeatures = Record<string, boolean | number | string>;

/**
 * Structured, typed limits derived from a plan tier (REQ-4). Distinct from the
 * open {@link PlanFeatures} map so the seat allowance has a stable, documented
 * shape the frontend can rely on. `seats` is `null` when the plan grants an
 * unlimited / unmetered seat count.
 */
export interface PlanLimits {
  seats: number | null;
}

/**
 * Public response shape for plan endpoints. Uses the plan's `public_id` as `id`
 * and emits ISO-string timestamps so the type is JSON-safe over the wire.
 */
export interface PlanOutput {
  id: string;
  name: string;
  description: string | null;
  price_monthly: string;
  price_yearly: string;
  currency: string;
  is_active: boolean;
  // REQ-4: the previously-stripped `features` jsonb is now surfaced verbatim so
  // the frontend can gate UI on plan capabilities.
  features: PlanFeatures;
  // REQ-4: typed seat allowance (`null` = unlimited) so the FE can render seat
  // usage against the plan limit without parsing the open `features` map.
  limits: PlanLimits;
  created_at: string;
  updated_at: string;
}
