import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { appointmentStatusEnum, changedByEnum } from './enums'
import { appointments } from './appointments'
import { tenants } from './tenants'

export const appointmentAuditLog = pgTable('appointment_audit_log', {
  id: uuid('id').primaryKey().defaultRandom(),

  appointmentId: uuid('appointment_id')
    .notNull()
    .references(() => appointments.id, { onDelete: 'cascade' }),

  /**
   * Redundante por design — derivável via appointment_id → appointments.tenant_id.
   * Presente aqui para permitir aplicação de Row-Level Security diretamente
   * nesta tabela sem necessidade de JOIN.
   */
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),

  /**
   * Status anterior. Null apenas para o primeiro registro (criação).
   */
  fromStatus: appointmentStatusEnum('from_status'),

  toStatus: appointmentStatusEnum('to_status').notNull(),

  changedBy: changedByEnum('changed_by').notNull(),

  /**
   * JSON serializado com contexto adicional da transição.
   * Exemplos:
   * - { "ip": "201.x.x.x", "userAgent": "Mozilla..." }  (cancelamento pelo cliente)
   * - { "reason": "cliente solicitou remarcação" }        (cancelamento pelo prestador)
   * - { "jobId": "bullmq-job-id" }                        (lembrete enviado pelo sistema)
   */
  metadata: text('metadata'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('audit_log_appointment_id_idx').on(table.appointmentId),
  index('audit_log_tenant_id_idx').on(table.tenantId),
])

export const appointmentAuditLogRelations = relations(appointmentAuditLog, ({ one }) => ({
  appointment: one(appointments, {
    fields:     [appointmentAuditLog.appointmentId],
    references: [appointments.id],
  }),
  tenant: one(tenants, {
    fields:     [appointmentAuditLog.tenantId],
    references: [tenants.id],
  }),
}))

export type AppointmentAuditLog    = typeof appointmentAuditLog.$inferSelect
export type NewAppointmentAuditLog = typeof appointmentAuditLog.$inferInsert
