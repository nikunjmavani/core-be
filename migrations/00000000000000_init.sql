-- migration-safety: allow missing_if_not_exists_on_create reason="Single scratch-database init migration; applied once to an empty database by schema_migrations."
-- migration-safety: allow create_index_without_concurrently reason="Transactional migrate.ts runner cannot execute CREATE INDEX CONCURRENTLY."
-- migration-safety: allow add_foreign_key_without_not_valid reason="Single scratch-database init migration creates empty tables before data exists."
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "auth";
--> statement-breakpoint
CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE SCHEMA "notify";
--> statement-breakpoint
CREATE SCHEMA "tenancy";
--> statement-breakpoint
CREATE SCHEMA "upload";
--> statement-breakpoint
DO $$
BEGIN
	CREATE ROLE core_be_app NOLOGIN;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE "audit"."logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_user_id" bigint,
	"target_user_id" bigint,
	"organization_id" bigint,
	"action" varchar(100) NOT NULL,
	"resource_type" varchar(50) NOT NULL,
	"resource_id" bigint,
	"ip_address" varchar(45),
	"user_agent" text,
	"severity" varchar(20) DEFAULT 'INFO' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_audit_severity" CHECK ("audit"."logs"."severity" IN ('DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'))
);
--> statement-breakpoint
ALTER TABLE "audit"."logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."auth_methods" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"method_type" varchar(20) NOT NULL,
	"provider" varchar(50),
	"provider_user_id" varchar(255),
	"encrypted_secret" text,
	"phone_number" varchar(20),
	"is_primary" boolean DEFAULT false NOT NULL,
	"verified_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by_user_id" bigint,
	CONSTRAINT "chk_auth_methods_type" CHECK ("auth"."auth_methods"."method_type" IN ('PASSWORD', 'MAGIC_LINK', 'OAUTH', 'MFA_TOTP', 'MFA_SMS', 'MFA_EMAIL'))
);
--> statement-breakpoint
CREATE TABLE "auth"."mail_outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"to_addresses" jsonb NOT NULL,
	"subject" varchar(500) NOT NULL,
	"html" text NOT NULL,
	"text_body" text,
	"reply_to" varchar(320),
	"tags" jsonb,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"resend_message_id" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	CONSTRAINT "mail_outbox_status_check" CHECK ("auth"."mail_outbox"."status" IN ('pending', 'sending', 'sent', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "auth"."verification_tokens" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"token_type" varchar(30) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_id" bigint NOT NULL,
	"email" varchar(255) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "auth"."verification_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."sessions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"user_id" bigint NOT NULL,
	"organization_id" bigint,
	"token_hash" varchar(64) NOT NULL,
	"ip_address" "inet" NOT NULL,
	"user_agent" text,
	"last_active_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "chk_sessions_expires" CHECK ("auth"."sessions"."expires_at" > "auth"."sessions"."created_at"),
	CONSTRAINT "chk_sessions_last_active" CHECK ("auth"."sessions"."last_active_at" >= "auth"."sessions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth"."sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."mfa_methods" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"user_id" bigint NOT NULL,
	"method_type" varchar(20) NOT NULL,
	"encrypted_secret" text,
	"phone_number" varchar(20),
	"is_verified" boolean DEFAULT false NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"last_used_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	CONSTRAINT "mfa_methods_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "auth"."mfa_recovery_codes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth"."webauthn_credentials" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"credential_id" text NOT NULL,
	"public_key" text NOT NULL,
	"counter" bigint DEFAULT 0 NOT NULL,
	"device_type" varchar(32) DEFAULT 'singleDevice' NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"transports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "billing"."plans" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"price_monthly" numeric(10, 2) NOT NULL,
	"price_yearly" numeric(10, 2) NOT NULL,
	"currency" varchar(3) DEFAULT 'USD' NOT NULL,
	"features" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"stripe_product_id" varchar(255),
	"stripe_price_monthly_id" varchar(255),
	"stripe_price_yearly_id" varchar(255),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_plans_price_m" CHECK ("billing"."plans"."price_monthly" >= 0),
	CONSTRAINT "chk_plans_price_y" CHECK ("billing"."plans"."price_yearly" >= 0),
	CONSTRAINT "chk_plans_currency" CHECK ("billing"."plans"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "chk_plans_updated" CHECK ("billing"."plans"."updated_at" >= "billing"."plans"."created_at")
);
--> statement-breakpoint
CREATE TABLE "billing"."stripe_webhook_events" (
	"stripe_event_id" varchar(255) PRIMARY KEY NOT NULL,
	"event_type" varchar(128) NOT NULL,
	"stripe_created_at" timestamp with time zone NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_status" varchar(32) DEFAULT 'processing' NOT NULL,
	"failure_reason" text,
	"request_id" varchar(255),
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stripe_webhook_events_processing_status_check" CHECK ("billing"."stripe_webhook_events"."processing_status" IN ('processing', 'processed', 'skipped_duplicate', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "billing"."subscriptions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"organization_id" bigint NOT NULL,
	"plan_id" bigint NOT NULL,
	"provider" varchar(50),
	"provider_subscription_id" varchar(255),
	"provider_customer_id" varchar(255),
	"billing_cycle" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'TRIALING' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"trial_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"canceled_at" timestamp with time zone,
	"last_stripe_event_created_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_subs_status" CHECK ("billing"."subscriptions"."status" IN ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'PAUSED')),
	CONSTRAINT "chk_subs_cycle" CHECK ("billing"."subscriptions"."billing_cycle" IN ('MONTHLY', 'YEARLY')),
	CONSTRAINT "chk_subs_period" CHECK ("billing"."subscriptions"."current_period_end" > "billing"."subscriptions"."current_period_start"),
	CONSTRAINT "chk_subs_updated" CHECK ("billing"."subscriptions"."updated_at" >= "billing"."subscriptions"."created_at")
);
--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notify"."notifications" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"user_id" bigint NOT NULL,
	"organization_id" bigint,
	"type" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"message" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"action_url" varchar(512),
	"action_label" varchar(50),
	"is_read" boolean DEFAULT false NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_notifications_read" CHECK (NOT "notify"."notifications"."is_read" OR "notify"."notifications"."read_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "notify"."notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notify"."webhook_delivery_attempts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"webhook_id" bigint NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_key" varchar(255),
	"payload" jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"http_status_code" integer,
	"response_body" text,
	"sent_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_retry_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_webhook_attempts_status" CHECK ("notify"."webhook_delivery_attempts"."status" IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
	CONSTRAINT "chk_webhook_attempts_count" CHECK ("notify"."webhook_delivery_attempts"."attempt_count" >= 0 AND "notify"."webhook_delivery_attempts"."attempt_count" <= 5)
);
--> statement-breakpoint
ALTER TABLE "notify"."webhook_delivery_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "notify"."webhooks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"organization_id" bigint NOT NULL,
	"url" text NOT NULL,
	"encrypted_secret" varchar(255) NOT NULL,
	"events" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_webhooks_url" CHECK ("notify"."webhooks"."url" ~ '^https://'),
	CONSTRAINT "chk_webhooks_updated" CHECK ("notify"."webhooks"."updated_at" >= "notify"."webhooks"."created_at")
);
--> statement-breakpoint
ALTER TABLE "notify"."webhooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."role_permissions" (
	"role_id" bigint NOT NULL,
	"permission_code" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	CONSTRAINT "pk_role_permissions" PRIMARY KEY("role_id","permission_code")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."roles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"organization_id" bigint NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_roles_updated" CHECK ("tenancy"."roles"."updated_at" >= "tenancy"."roles"."created_at")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."member_invitations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"membership_id" bigint NOT NULL,
	"email" varchar(255) NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"invited_by_user_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	CONSTRAINT "chk_member_inv_expires" CHECK ("tenancy"."member_invitations"."expires_at" > "tenancy"."member_invitations"."created_at"),
	CONSTRAINT "chk_member_inv_accepted" CHECK ("tenancy"."member_invitations"."accepted_at" IS NULL OR "tenancy"."member_invitations"."revoked_at" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "tenancy"."member_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."memberships" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"user_id" bigint NOT NULL,
	"organization_id" bigint NOT NULL,
	"role_id" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'INVITED' NOT NULL,
	"invited_by_user_id" bigint,
	"joined_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_memberships_status" CHECK ("tenancy"."memberships"."status" IN ('INVITED', 'ACTIVE', 'SUSPENDED')),
	CONSTRAINT "chk_memberships_joined" CHECK ("tenancy"."memberships"."status" != 'ACTIVE' OR "tenancy"."memberships"."joined_at" IS NOT NULL),
	CONSTRAINT "chk_memberships_updated" CHECK ("tenancy"."memberships"."updated_at" >= "tenancy"."memberships"."created_at")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."api_keys" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"organization_id" bigint NOT NULL,
	"name" varchar(255) NOT NULL,
	"key_hash" varchar(255) NOT NULL,
	"key_prefix" varchar(10) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_api_keys_status" CHECK ("tenancy"."api_keys"."status" IN ('ACTIVE', 'REVOKED')),
	CONSTRAINT "chk_api_keys_updated" CHECK ("tenancy"."api_keys"."updated_at" >= "tenancy"."api_keys"."created_at")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."organization_notification_policies" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"organization_id" bigint NOT NULL,
	"notification_type" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"default_enabled" boolean DEFAULT true NOT NULL,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"muted_until" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_org_notif_channel" CHECK ("tenancy"."organization_notification_policies"."channel" IN ('EMAIL', 'SMS', 'PUSH', 'IN_APP')),
	CONSTRAINT "chk_org_notif_muted" CHECK ("tenancy"."organization_notification_policies"."muted_until" IS NULL OR "tenancy"."organization_notification_policies"."muted_until" > now()),
	CONSTRAINT "chk_org_notif_updated" CHECK ("tenancy"."organization_notification_policies"."updated_at" >= "tenancy"."organization_notification_policies"."created_at")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."organization_notification_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."organization_settings" (
	"organization_id" bigint PRIMARY KEY NOT NULL,
	"is_email_notifications_enabled" boolean DEFAULT true NOT NULL,
	"default_locale" varchar(5) DEFAULT 'en' NOT NULL,
	"security_policy" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_org_settings_updated" CHECK ("tenancy"."organization_settings"."updated_at" >= "tenancy"."organization_settings"."created_at"),
	CONSTRAINT "chk_organization_settings_default_locale" CHECK ("tenancy"."organization_settings"."default_locale" IN ('en', 'es'))
);
--> statement-breakpoint
ALTER TABLE "tenancy"."organization_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."organizations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"owner_user_id" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"logo_url" varchar(512),
	"stripe_customer_id" varchar(255),
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_organizations_status" CHECK ("tenancy"."organizations"."status" IN ('ACTIVE', 'SUSPENDED', 'ARCHIVED')),
	CONSTRAINT "chk_organizations_slug" CHECK ("tenancy"."organizations"."slug" ~ '^[a-z0-9-]+$'),
	CONSTRAINT "chk_organizations_updated" CHECK ("tenancy"."organizations"."updated_at" >= "tenancy"."organizations"."created_at")
);
--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "tenancy"."permissions" (
	"code" varchar(100) PRIMARY KEY NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"category" varchar(50) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload"."uploads" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"user_id" bigint NOT NULL,
	"organization_id" bigint,
	"file_name" varchar(255) NOT NULL,
	"file_key" varchar(512) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"file_size" integer NOT NULL,
	"storage_provider" varchar(20) DEFAULT 's3' NOT NULL,
	"bucket" varchar(100) NOT NULL,
	"status" varchar(20) DEFAULT 'PENDING' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"uploaded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	CONSTRAINT "chk_uploads_file_size" CHECK ("upload"."uploads"."file_size" >= 0),
	CONSTRAINT "chk_uploads_status" CHECK ("upload"."uploads"."status" IN ('PENDING', 'UPLOADED', 'FAILED'))
);
--> statement-breakpoint
ALTER TABLE "upload"."uploads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."user_data_exports" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"user_id" bigint NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"s3_key" varchar(512),
	"expires_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_data_exports_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "user_data_exports_status_check" CHECK ("auth"."user_data_exports"."status" IN ('pending', 'processing', 'completed', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "auth"."user_notification_preferences" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"organization_id" bigint,
	"notification_type" varchar(50) NOT NULL,
	"channel" varchar(20) NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by_user_id" bigint,
	"updated_by_user_id" bigint,
	CONSTRAINT "chk_user_notif_prefs_channel" CHECK ("auth"."user_notification_preferences"."channel" IN ('EMAIL', 'SMS', 'PUSH', 'IN_APP')),
	CONSTRAINT "chk_user_notif_prefs_updated" CHECK ("auth"."user_notification_preferences"."updated_at" >= "auth"."user_notification_preferences"."created_at")
);
--> statement-breakpoint
ALTER TABLE "auth"."user_notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "auth"."user_settings" (
	"user_id" bigint PRIMARY KEY NOT NULL,
	"is_dark_mode_enabled" boolean DEFAULT false NOT NULL,
	"is_notifications_enabled" boolean DEFAULT true NOT NULL,
	"language" varchar(10) DEFAULT 'en' NOT NULL,
	"preferred_locales" jsonb DEFAULT '["en"]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_user_settings_updated" CHECK ("auth"."user_settings"."updated_at" >= "auth"."user_settings"."created_at")
);
--> statement-breakpoint
CREATE TABLE "auth"."users" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"public_id" varchar(28) NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_hash" varchar(64) NOT NULL,
	"is_email_verified" boolean DEFAULT false NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"avatar_url" varchar(512),
	"password_hash" varchar(255),
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"account_locked_until" timestamp with time zone,
	"last_password_change_at" timestamp with time zone,
	"is_mfa_enabled" boolean DEFAULT false NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"last_active_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chk_users_status" CHECK ("auth"."users"."status" IN ('ACTIVE', 'LOCKED', 'SUSPENDED')),
	CONSTRAINT "chk_users_failed_login" CHECK ("auth"."users"."failed_login_count" >= 0),
	CONSTRAINT "chk_users_updated" CHECK ("auth"."users"."updated_at" >= "auth"."users"."created_at")
);
--> statement-breakpoint
ALTER TABLE "audit"."logs" ADD CONSTRAINT "logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."logs" ADD CONSTRAINT "logs_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "auth"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit"."logs" ADD CONSTRAINT "logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."auth_methods" ADD CONSTRAINT "auth_methods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."auth_methods" ADD CONSTRAINT "auth_methods_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."plans" ADD CONSTRAINT "plans_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."plans" ADD CONSTRAINT "plans_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "billing"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify"."notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify"."notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify"."webhook_delivery_attempts" ADD CONSTRAINT "webhook_delivery_attempts_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "notify"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify"."webhooks" ADD CONSTRAINT "webhooks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify"."webhooks" ADD CONSTRAINT "webhooks_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notify"."webhooks" ADD CONSTRAINT "webhooks_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "tenancy"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ADD CONSTRAINT "role_permissions_permission_code_permissions_code_fk" FOREIGN KEY ("permission_code") REFERENCES "tenancy"."permissions"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."role_permissions" ADD CONSTRAINT "role_permissions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."roles" ADD CONSTRAINT "roles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."roles" ADD CONSTRAINT "roles_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."roles" ADD CONSTRAINT "roles_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."member_invitations" ADD CONSTRAINT "member_invitations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "tenancy"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."member_invitations" ADD CONSTRAINT "member_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."member_invitations" ADD CONSTRAINT "member_invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "tenancy"."roles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."memberships" ADD CONSTRAINT "memberships_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."api_keys" ADD CONSTRAINT "api_keys_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organization_notification_policies" ADD CONSTRAINT "organization_notification_policies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organization_notification_policies" ADD CONSTRAINT "organization_notification_policies_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organization_notification_policies" ADD CONSTRAINT "organization_notification_policies_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organization_settings" ADD CONSTRAINT "organization_settings_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organization_settings" ADD CONSTRAINT "organization_settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD CONSTRAINT "organizations_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD CONSTRAINT "organizations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenancy"."organizations" ADD CONSTRAINT "organizations_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload"."uploads" ADD CONSTRAINT "uploads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload"."uploads" ADD CONSTRAINT "uploads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload"."uploads" ADD CONSTRAINT "uploads_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_data_exports" ADD CONSTRAINT "user_data_exports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "tenancy"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_notification_preferences" ADD CONSTRAINT "user_notification_preferences_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth"."user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_org_created" ON "audit"."logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_actor_created" ON "audit"."logs" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_resource" ON "audit"."logs" USING btree ("resource_type","resource_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_created_at" ON "audit"."logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_severity_created" ON "audit"."logs" USING btree ("severity","created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_logs_action_created" ON "audit"."logs" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "idx_auth_methods_user_type" ON "auth"."auth_methods" USING btree ("user_id","method_type");--> statement-breakpoint
CREATE INDEX "idx_auth_methods_provider" ON "auth"."auth_methods" USING btree ("provider","provider_user_id");--> statement-breakpoint
CREATE INDEX "idx_auth_methods_user_revoked" ON "auth"."auth_methods" USING btree ("user_id","revoked_at");--> statement-breakpoint
CREATE INDEX "idx_auth_methods_user_primary" ON "auth"."auth_methods" USING btree ("user_id","is_primary");--> statement-breakpoint
CREATE INDEX "idx_mail_outbox_status_created_at" ON "auth"."mail_outbox" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_verification_tokens_token_hash" ON "auth"."verification_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_verification_tokens_user_type" ON "auth"."verification_tokens" USING btree ("user_id","token_type");--> statement-breakpoint
CREATE INDEX "idx_sessions_user_status" ON "auth"."sessions" USING btree ("user_id","is_revoked","expires_at");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "auth"."sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_mfa_recovery_codes_user_code_hash" ON "auth"."mfa_recovery_codes" USING btree ("user_id","code_hash");--> statement-breakpoint
CREATE INDEX "idx_mfa_recovery_codes_user_unused" ON "auth"."mfa_recovery_codes" USING btree ("user_id") WHERE "auth"."mfa_recovery_codes"."used_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_unique" ON "auth"."webauthn_credentials" USING btree ("credential_id") WHERE "auth"."webauthn_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "webauthn_credentials_user_id_idx" ON "auth"."webauthn_credentials" USING btree ("user_id") WHERE "auth"."webauthn_credentials"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plans_public_id" ON "billing"."plans" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_plans_name" ON "billing"."plans" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_plans_active" ON "billing"."plans" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_plans_active_price" ON "billing"."plans" USING btree ("is_active","price_monthly");--> statement-breakpoint
CREATE INDEX "idx_stripe_webhook_events_status_created" ON "billing"."stripe_webhook_events" USING btree ("processing_status","stripe_created_at");--> statement-breakpoint
CREATE INDEX "idx_stripe_webhook_events_status_updated" ON "billing"."stripe_webhook_events" USING btree ("processing_status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_public_id" ON "billing"."subscriptions" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_subscriptions_org" ON "billing"."subscriptions" USING btree ("organization_id") WHERE "billing"."subscriptions"."status" <> 'CANCELED';--> statement-breakpoint
CREATE INDEX "idx_subscriptions_org_status" ON "billing"."subscriptions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_plan" ON "billing"."subscriptions" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_status_period" ON "billing"."subscriptions" USING btree ("status","current_period_end");--> statement-breakpoint
CREATE INDEX "idx_subscriptions_provider_subscription_id" ON "billing"."subscriptions" USING btree ("provider_subscription_id") WHERE "billing"."subscriptions"."provider_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_notifications_public_id" ON "notify"."notifications" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_read" ON "notify"."notifications" USING btree ("user_id","is_read","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_org" ON "notify"."notifications" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_type" ON "notify"."notifications" USING btree ("type","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_created" ON "notify"."notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_attempts_webhook" ON "notify"."webhook_delivery_attempts" USING btree ("webhook_id","event_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_webhook_attempts_retry" ON "notify"."webhook_delivery_attempts" USING btree ("status","next_retry_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_webhook_delivery_attempts_pending_event_key" ON "notify"."webhook_delivery_attempts" USING btree ("webhook_id","event_key") WHERE "notify"."webhook_delivery_attempts"."status" = 'PENDING' AND "notify"."webhook_delivery_attempts"."event_key" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_webhooks_public_id" ON "notify"."webhooks" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_webhooks_org_enabled" ON "notify"."webhooks" USING btree ("organization_id","is_enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_webhooks_organization_id_url_unique" ON "notify"."webhooks" USING btree ("organization_id","url");--> statement-breakpoint
CREATE INDEX "idx_role_permissions_code" ON "tenancy"."role_permissions" USING btree ("permission_code");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_roles_public_id" ON "tenancy"."roles" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_roles_org_name" ON "tenancy"."roles" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "idx_roles_org_system" ON "tenancy"."roles" USING btree ("organization_id","is_system");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_roles_org_name_unique" ON "tenancy"."roles" USING btree ("organization_id","name") WHERE "tenancy"."roles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_member_invitations_public_id" ON "tenancy"."member_invitations" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_member_invitations_token" ON "tenancy"."member_invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_member_invitations_membership" ON "tenancy"."member_invitations" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "idx_member_invitations_email" ON "tenancy"."member_invitations" USING btree ("email","accepted_at");--> statement-breakpoint
CREATE INDEX "idx_member_invitations_expires" ON "tenancy"."member_invitations" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memberships_public_id" ON "tenancy"."memberships" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_memberships_user_org" ON "tenancy"."memberships" USING btree ("user_id","organization_id");--> statement-breakpoint
CREATE INDEX "idx_memberships_org_status" ON "tenancy"."memberships" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_memberships_user_status" ON "tenancy"."memberships" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_memberships_role" ON "tenancy"."memberships" USING btree ("role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_memberships_user_org_unique" ON "tenancy"."memberships" USING btree ("user_id","organization_id") WHERE "tenancy"."memberships"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "idx_api_keys_public_id" ON "tenancy"."api_keys" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_organization" ON "tenancy"."api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "idx_api_keys_organization_status" ON "tenancy"."api_keys" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "idx_api_keys_key_prefix" ON "tenancy"."api_keys" USING btree ("key_prefix");--> statement-breakpoint
CREATE INDEX "idx_api_keys_deleted" ON "tenancy"."api_keys" USING btree ("deleted_at") WHERE "tenancy"."api_keys"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_api_keys_scopes_gin" ON "tenancy"."api_keys" USING gin ("scopes");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organization_notification_policies_public_id" ON "tenancy"."organization_notification_policies" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_org_notif_policy_unique" ON "tenancy"."organization_notification_policies" USING btree ("organization_id","notification_type","channel");--> statement-breakpoint
CREATE INDEX "idx_org_notif_policy_mandatory" ON "tenancy"."organization_notification_policies" USING btree ("organization_id","is_mandatory");--> statement-breakpoint
CREATE INDEX "idx_org_notif_policy_muted" ON "tenancy"."organization_notification_policies" USING btree ("muted_until");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organizations_public_id" ON "tenancy"."organizations" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organizations_slug" ON "tenancy"."organizations" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_organizations_owner" ON "tenancy"."organizations" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_organizations_status_deleted" ON "tenancy"."organizations" USING btree ("status","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_organizations_created_at" ON "tenancy"."organizations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_organizations_active" ON "tenancy"."organizations" USING btree ("name") WHERE "tenancy"."organizations"."deleted_at" IS NULL AND "tenancy"."organizations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE UNIQUE INDEX "idx_organizations_stripe_customer_id" ON "tenancy"."organizations" USING btree ("stripe_customer_id") WHERE "tenancy"."organizations"."stripe_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_permissions_category" ON "tenancy"."permissions" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_permissions_name" ON "tenancy"."permissions" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_uploads_public_id" ON "upload"."uploads" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_user_id" ON "upload"."uploads" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_uploads_organization_id" ON "upload"."uploads" USING btree ("organization_id") WHERE "upload"."uploads"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_user_data_exports_user_id" ON "auth"."user_data_exports" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_data_exports_user_id_status" ON "auth"."user_data_exports" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_user_data_exports_expires_at" ON "auth"."user_data_exports" USING btree ("expires_at") WHERE "auth"."user_data_exports"."expires_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_user_notif_prefs_user_type" ON "auth"."user_notification_preferences" USING btree ("user_id","notification_type","channel");--> statement-breakpoint
CREATE INDEX "idx_user_notif_prefs_org" ON "auth"."user_notification_preferences" USING btree ("organization_id","notification_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_public_id" ON "auth"."users" USING btree ("public_id");--> statement-breakpoint
CREATE INDEX "idx_users_email" ON "auth"."users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_email_hash" ON "auth"."users" USING btree ("email_hash");--> statement-breakpoint
CREATE INDEX "idx_users_status_deleted" ON "auth"."users" USING btree ("status","deleted_at");--> statement-breakpoint
CREATE INDEX "idx_users_last_active" ON "auth"."users" USING btree ("last_active_at");--> statement-breakpoint
CREATE INDEX "idx_users_verified_status" ON "auth"."users" USING btree ("is_email_verified","status");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_users_email_unique" ON "auth"."users" USING btree ("email") WHERE "auth"."users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_last_active_not_deleted" ON "auth"."users" USING btree ("last_active_at") WHERE "auth"."users"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_users_locked" ON "auth"."users" USING btree ("account_locked_until") WHERE "auth"."users"."account_locked_until" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_users_email_trgm" ON "auth"."users" USING gin ("email" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "idx_users_display_name_trgm" ON "auth"."users" USING gin ((coalesce("first_name", '') || ' ' || coalesce("last_name", '')) gin_trgm_ops);--> statement-breakpoint
CREATE POLICY "audit_logs_tenant_isolation" ON "audit"."logs" AS PERMISSIVE FOR ALL TO public USING ("audit"."logs"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "verification_tokens_application_access" ON "auth"."verification_tokens" AS PERMISSIVE FOR ALL TO public USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "sessions_user_access" ON "auth"."sessions" AS PERMISSIVE FOR ALL TO public USING ((
          "auth"."sessions"."user_id" = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
          OR "auth"."sessions"."public_id" = current_setting('app.current_session_public_id', true)
          OR "auth"."sessions"."token_hash" = current_setting('app.current_session_token_hash', true)
          OR current_setting('app.session_retention_cleanup', true) = 'true'
        )) WITH CHECK ((
          "auth"."sessions"."user_id" = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
          OR "auth"."sessions"."public_id" = current_setting('app.current_session_public_id', true)
          OR "auth"."sessions"."token_hash" = current_setting('app.current_session_token_hash', true)
          OR current_setting('app.session_retention_cleanup', true) = 'true'
        ));--> statement-breakpoint
CREATE POLICY "subscriptions_tenant_isolation" ON "billing"."subscriptions" AS PERMISSIVE FOR ALL TO public USING ("billing"."subscriptions"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "notifications_tenant_isolation" ON "notify"."notifications" AS PERMISSIVE FOR ALL TO public USING ((
            "notify"."notifications"."organization_id" IS NOT NULL
            AND "notify"."notifications"."organization_id" = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "webhook_delivery_attempts_tenant_isolation" ON "notify"."webhook_delivery_attempts" AS PERMISSIVE FOR ALL TO public USING ("notify"."webhook_delivery_attempts"."webhook_id" IN (
            SELECT id FROM notify.webhooks
            WHERE organization_id = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "webhooks_tenant_isolation" ON "notify"."webhooks" AS PERMISSIVE FOR ALL TO public USING ("notify"."webhooks"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "role_permissions_tenant_isolation" ON "tenancy"."role_permissions" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."role_permissions"."role_id" IN (
            SELECT id FROM tenancy.roles
            WHERE organization_id = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "roles_tenant_isolation" ON "tenancy"."roles" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."roles"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "member_invitations_tenant_isolation" ON "tenancy"."member_invitations" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."member_invitations"."membership_id" IN (
            SELECT id FROM tenancy.memberships
            WHERE organization_id = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "memberships_tenant_isolation" ON "tenancy"."memberships" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."memberships"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "api_keys_tenant_isolation" ON "tenancy"."api_keys" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."api_keys"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "organization_notification_policies_tenant_isolation" ON "tenancy"."organization_notification_policies" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."organization_notification_policies"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "organization_settings_tenant_isolation" ON "tenancy"."organization_settings" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."organization_settings"."organization_id" = (
            SELECT id FROM tenancy.organizations
            WHERE public_id = current_setting('app.current_organization_id', true)
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "organizations_tenant_isolation" ON "tenancy"."organizations" AS PERMISSIVE FOR ALL TO public USING ("tenancy"."organizations"."public_id" = current_setting('app.current_organization_id', true)
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "uploads_tenant_isolation" ON "upload"."uploads" AS PERMISSIVE FOR ALL TO public USING ((
            "upload"."uploads"."organization_id" IS NOT NULL
            AND "upload"."uploads"."organization_id" = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )
          OR current_setting('app.global_retention_cleanup', true) = 'true');--> statement-breakpoint
CREATE POLICY "user_notification_preferences_user_org_access" ON "auth"."user_notification_preferences" AS PERMISSIVE FOR ALL TO public USING ("auth"."user_notification_preferences"."user_id" = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
          AND (
            "auth"."user_notification_preferences"."organization_id" IS NULL
            OR "auth"."user_notification_preferences"."organization_id" = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          )) WITH CHECK ("auth"."user_notification_preferences"."user_id" = (
            SELECT id FROM auth.users
            WHERE public_id = current_setting('app.current_user_id', true)
              AND deleted_at IS NULL
          )
          AND (
            "auth"."user_notification_preferences"."organization_id" IS NULL
            OR "auth"."user_notification_preferences"."organization_id" = (
              SELECT id FROM tenancy.organizations
              WHERE public_id = current_setting('app.current_organization_id', true)
            )
          ));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION billing.resolve_organization_public_id_for_stripe_subscription (
  provider_subscription_id_param TEXT
) RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = billing, tenancy, public
AS $$
  SELECT o.public_id
  FROM billing.subscriptions AS s
  INNER JOIN tenancy.organizations AS o ON o.id = s.organization_id
  WHERE s.provider_subscription_id = provider_subscription_id_param
  LIMIT 1;
$$;
--> statement-breakpoint
DO $$
DECLARE
  database_name TEXT := current_database();
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO core_be_app', database_name);
END $$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA auth, tenancy, billing, notify, audit, upload TO core_be_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth, tenancy, billing, notify, audit, upload TO core_be_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auth, tenancy, billing, notify, audit, upload TO core_be_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_be_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA tenancy GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_be_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA billing GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_be_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA notify GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_be_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA audit GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_be_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA upload GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO core_be_app;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION billing.resolve_organization_public_id_for_stripe_subscription (TEXT) TO core_be_app;
--> statement-breakpoint
ALTER TABLE tenancy.organizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.memberships FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.member_invitations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.roles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.role_permissions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.organization_settings FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.organization_notification_policies FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE tenancy.api_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE billing.subscriptions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notify.webhooks FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notify.webhook_delivery_attempts FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE notify.notifications FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit.logs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE upload.uploads FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.verification_tokens FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE auth.user_notification_preferences FORCE ROW LEVEL SECURITY;