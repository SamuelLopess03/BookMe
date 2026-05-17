-- migration: 0001_row_level_security.sql

-- Habilitar RLS nas tabelas de domínio
ALTER TABLE services               ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_blocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_audit_log  ENABLE ROW LEVEL SECURITY;

-- Política de isolamento por Tenant:
-- USING: Garante que SELECT e DELETE só retornem/afetem registros do tenant atual.
-- WITH CHECK: Garante que INSERT e UPDATE não permitam salvar/alterar registros para outro tenant_id.

CREATE POLICY tenant_isolation ON services
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON availability_schedules
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON availability_blocks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON appointment_audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
