-- Align billing.subscriptions status check with all Stripe-mapped lifecycle states.

ALTER TABLE billing.subscriptions DROP CONSTRAINT IF EXISTS chk_subs_status;
--> statement-breakpoint

ALTER TABLE billing.subscriptions ADD CONSTRAINT chk_subs_status CHECK (
  status IN (
    'TRIALING',
    'ACTIVE',
    'PAST_DUE',
    'CANCELED',
    'PAUSED',
    'UNPAID',
    'INCOMPLETE',
    'INCOMPLETE_EXPIRED'
  )
) NOT VALID;
--> statement-breakpoint

ALTER TABLE billing.subscriptions VALIDATE CONSTRAINT chk_subs_status;
