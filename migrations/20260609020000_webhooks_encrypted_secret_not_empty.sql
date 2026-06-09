-- P0-#1 defense in depth: prevent any future regression or direct DB write from
-- storing a webhook row with an empty encrypted_secret. The application layer
-- (DTO .min(16), service guard, worker fail-closed) is the primary defense — this
-- CHECK constraint is the floor so an out-of-band write cannot reintroduce the
-- "ship payload without X-Webhook-Signature" condition that lets an attacker who
-- can flip the secret to '' (or read a legitimate unsigned delivery) forge any
-- subsequent unsigned request against the receiver.

ALTER TABLE notify.webhooks
  ADD CONSTRAINT chk_webhooks_encrypted_secret_not_empty
  CHECK (length(encrypted_secret) > 0)
  NOT VALID;
--> statement-breakpoint
-- Validate against existing rows. Any row failing this is a pre-existing data
-- corruption that needs an operator-led secret rotation; the validation here
-- surfaces the bad row up front instead of letting deliveries fail later.
ALTER TABLE notify.webhooks
  VALIDATE CONSTRAINT chk_webhooks_encrypted_secret_not_empty;
