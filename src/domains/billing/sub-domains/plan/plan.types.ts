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
  created_at: string;
  updated_at: string;
}
