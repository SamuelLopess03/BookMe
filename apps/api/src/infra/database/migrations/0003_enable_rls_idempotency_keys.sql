-- migration: 0003_enable_rls_idempotency_keys.sql

-- Habilita Row Level Security para a tabela idempotency_keys
-- Aplicado separadamente para não alterar migrations já aplicadas

ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON idempotency_keys
  USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
