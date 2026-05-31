ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_status_response_chk" CHECK (
  (
    status = 'completed' AND response IS NOT NULL
  ) OR (
    status IN ('processing', 'failed') AND response IS NULL
  )
);