import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  foreignKey,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { appointmentStatusEnum, changedByEnum } from "./enums";
import { appointments } from "./appointments";
import { tenants } from "./tenants";

/**
 * Tabela de Auditoria: Registro imutável de mudanças de status.
 *
 * SEGURANÇA: Esta tabela deve ter uma Trigger de banco de dados (PostgreSQL)
 * para impedir UPDATE e DELETE, garantindo a integridade da trilha.
 */
export const appointmentAuditLog = pgTable(
  "appointment_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    appointmentId: uuid("appointment_id").notNull(),

    /**
     * Redundante por design — derivável via appointment_id → appointments.tenant_id.
     * Presente aqui para permitir aplicação de Row-Level Security diretamente
     * nesta tabela sem necessidade de JOIN.
     */
    tenantId: uuid("tenant_id").notNull(),

    /**
     * Status anterior. Null apenas para o primeiro registro (criação).
     */
    fromStatus: appointmentStatusEnum("from_status"),

    toStatus: appointmentStatusEnum("to_status").notNull(),

    changedBy: changedByEnum("changed_by").notNull(),

    /**
     * JSON serializado com contexto adicional da transição.
     */
    metadata: text("metadata"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_log_appointment_id_idx").on(table.appointmentId),
    index("audit_log_tenant_id_idx").on(table.tenantId),

    /**
     * CHAVE ESTRANGEIRA COMPOSTA (Integridade Multi-tenant):
     * Garante que o tenant_id do log seja OBRIGATORIAMENTE o mesmo
     * tenant_id do agendamento referenciado.
     */
    foreignKey({
      columns: [table.appointmentId, table.tenantId],
      foreignColumns: [appointments.id, appointments.tenantId],
    }).onDelete("cascade"),

    pgPolicy("tenant_isolation", {
      for: "all",
      using: sql`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
      withCheck: sql`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

export const appointmentAuditLogRelations = relations(
  appointmentAuditLog,
  ({ one }) => ({
    appointment: one(appointments, {
      fields: [appointmentAuditLog.appointmentId],
      references: [appointments.id],
    }),
    tenant: one(tenants, {
      fields: [appointmentAuditLog.tenantId],
      references: [tenants.id],
    }),
  }),
);

export type AppointmentAuditLog = typeof appointmentAuditLog.$inferSelect;
export type NewAppointmentAuditLog = typeof appointmentAuditLog.$inferInsert;
