-- migration: 0001_row_level_security.sql

-- Habilitar RLS nas tabelas de domínio
ALTER TABLE services               ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_blocks    ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_audit_log  ENABLE ROW LEVEL SECURITY;

-- Política de isolamento por Tenant:
-- Compara o tenant_id da linha com o valor setado na variável de sessão 'app.current_tenant_id'
-- O parâmetro 'true' no current_setting garante que retorne NULL se não estiver setado, evitando erro.

CREATE POLICY tenant_isolation ON services
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON availability_schedules
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON availability_blocks
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE POLICY tenant_isolation ON appointment_audit_log
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
