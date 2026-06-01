ALTER TABLE "idempotency_keys" DROP CONSTRAINT "idempotency_keys_pkey";--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_key_unique" UNIQUE("tenant_id","key");--> statement-breakpoint
