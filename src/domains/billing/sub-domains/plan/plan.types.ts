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
