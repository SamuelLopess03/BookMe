CREATE TABLE "idempotency_keys" (
	"key" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"endpoint" varchar(200) NOT NULL,
	"status" "idempotency_key_status" NOT NULL,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys" USING btree ("expires_at") WHERE status = 'completed';