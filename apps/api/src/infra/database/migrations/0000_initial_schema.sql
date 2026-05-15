CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'confirmed', 'rejected', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('client', 'tenant', 'system');--> statement-breakpoint
CREATE TYPE "public"."changed_by" AS ENUM('client', 'tenant', 'system');--> statement-breakpoint
CREATE TYPE "public"."idempotency_key_status" AS ENUM('processing', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"min_booking_notice_hours" integer DEFAULT 1 NOT NULL,
	"max_booking_days_ahead" integer DEFAULT 30 NOT NULL,
	"cancellation_deadline_hours" integer DEFAULT 2 NOT NULL,
	"appointment_interval_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_settings_tenant_id_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"slug" varchar(100) NOT NULL,
	"bio" text,
	"phone" varchar(20),
	"avatar_url" text,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_email_unique" UNIQUE("email"),
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"price_cents" integer,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "availability_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"day_of_week" integer NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "avail_schedules_tenant_day_start_uniq" UNIQUE("tenant_id","day_of_week","start_time")
);
--> statement-breakpoint
CREATE TABLE "availability_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"reason" varchar(255),
	"is_full_day" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"client_name" text NOT NULL,
	"client_email" text NOT NULL,
	"client_phone" varchar(20) NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "appointment_status" DEFAULT 'pending' NOT NULL,
	"cancellation_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"cancelled_by" "cancelled_by",
	"cancellation_reason" text,
	"cancelled_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_cancellation_token_unique" UNIQUE("cancellation_token"),
	CONSTRAINT "appointments_id_tenant_id_key" UNIQUE("id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "appointment_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"changed_by" "changed_by" NOT NULL,
	"metadata" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_schedules" ADD CONSTRAINT "availability_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_blocks" ADD CONSTRAINT "availability_blocks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_tenant_id_services_id_tenant_id_fk" FOREIGN KEY ("service_id","tenant_id") REFERENCES "public"."services"("id","tenant_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_audit_log" ADD CONSTRAINT "appointment_audit_log_appointment_id_tenant_id_appointments_id_tenant_id_fk" FOREIGN KEY ("appointment_id","tenant_id") REFERENCES "public"."appointments"("id","tenant_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "refresh_tokens_tenant_id_idx" ON "refresh_tokens" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "services_tenant_id_idx" ON "services" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "services_tenant_id_active_idx" ON "services" USING btree ("tenant_id") WHERE "services"."deleted_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "services_tenant_name_unique_idx" ON "services" USING btree ("tenant_id","name") WHERE "services"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "avail_schedules_tenant_day_idx" ON "availability_schedules" USING btree ("tenant_id","day_of_week");--> statement-breakpoint
CREATE INDEX "avail_blocks_tenant_id_idx" ON "availability_blocks" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "avail_blocks_tenant_range_idx" ON "availability_blocks" USING btree ("tenant_id","start_at","end_at");--> statement-breakpoint
CREATE INDEX "appointments_tenant_id_idx" ON "appointments" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "appointments_unique_slot_idx" ON "appointments" USING btree ("tenant_id","scheduled_at") WHERE status NOT IN ('cancelled', 'rejected');--> statement-breakpoint
CREATE INDEX "appointments_tenant_scheduled_at_idx" ON "appointments" USING btree ("tenant_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_pending_idx" ON "appointments" USING btree ("tenant_id","scheduled_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "appointments_cancellation_token_idx" ON "appointments" USING btree ("cancellation_token");--> statement-breakpoint
CREATE INDEX "appointments_status_idx" ON "appointments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "appointments_reminder_idx" ON "appointments" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "audit_log_appointment_id_idx" ON "appointment_audit_log" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "audit_log_tenant_id_idx" ON "appointment_audit_log" USING btree ("tenant_id");