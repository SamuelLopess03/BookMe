import {
  pgTable, uuid, varchar, text, timestamp, index, uniqueIndex, unique, foreignKey
} from 'drizzle-orm/pg-core'
import { relations, sql, eq } from 'drizzle-orm'
import { appointmentStatusEnum, cancelledByEnum } from './enums'
import { tenants } from './tenants'
import { services } from './services'
import { appointmentAuditLog } from './appointment-audit-log'

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),

  // ── Multi-tenancy ─────────────────────────────────────────
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),

  // ── Dados do serviço ─────────────────────────────────────
  serviceId: uuid('service_id').notNull(),

  // ── Dados do cliente ─────────────────────────────────────
  /**
   * O cliente NÃO tem conta no sistema.
   * Nome, e-mail e telefone são coletados no formulário de agendamento.
   * São os dados de contato para notificações e lembretes.
   */
  clientName:  text('client_name').notNull(),
  clientEmail: text('client_email').notNull(),
  clientPhone: varchar('client_phone', { length: 20 }).notNull(),

  // ── Horário ──────────────────────────────────────────────
  /**
   * Momento exato de início do atendimento (UTC).
   * A data e hora de exibição ao usuário são convertidas para o fuso
   * do prestador na camada de aplicação/frontend.
   */
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),

  /**
   * Momento de fim do atendimento, calculado na criação:
   * endsAt = scheduledAt + service.durationMinutes
   * Armazenado desnormalizadamente para simplificar queries de conflito.
   * (Sem endsAt, verificar sobreposição exigiria um JOIN com services em cada query).
   */
  endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),

  // ── Status ───────────────────────────────────────────────
  status: appointmentStatusEnum('status').notNull().default('pending'),

  // ── Cancelamento ─────────────────────────────────────────
  /**
   * UUID único e opaco enviado no link de cancelamento ao cliente.
   * Formato do link: GET /public/appointments/:cancellationToken/cancel
   * Gerado automaticamente no insert; nunca reutilizado.
   */
  cancellationToken: uuid('cancellation_token').notNull().defaultRandom().unique(),

  cancelledBy:        cancelledByEnum('cancelled_by'),
  cancellationReason: text('cancellation_reason'),
  cancelledAt:        timestamp('cancelled_at', { withTimezone: true }),

  // ── Observações ──────────────────────────────────────────
  /**
   * Observações livres do cliente ao agendar.
   * Ex: "Prefiro corte mais curto nas laterais".
   */
  notes: text('notes'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('appointments_tenant_id_idx').on(table.tenantId),

  /**
   * Garante que não haja duplo agendamento no mesmo horário (ADR-009).
   * Cria lock seguro de banco ignorando registros já cancelados/rejeitados.
   */
  uniqueIndex('appointments_unique_slot_idx')
    .on(table.tenantId, table.scheduledAt)
    .where(sql`status NOT IN ('cancelled', 'rejected')`),

  /**
   * Índice mais importante do sistema.
   * Toda query de agenda do prestador filtra por tenant + período de data.
   * Também usado no cálculo de disponibilidade.
   */
  index('appointments_tenant_scheduled_at_idx')
    .on(table.tenantId, table.scheduledAt),

  /**
   * Índice parcial para o dashboard: agendamentos que aguardam ação.
   * Reduz o tamanho do índice pois a maioria dos registros será 'completed' ou 'cancelled'.
   */
  index('appointments_pending_idx')
    .on(table.tenantId, table.scheduledAt)
    .where(eq(table.status, 'pending')),

  /**
   * Índice para lookup do token de cancelamento.
   * A rota pública DELETE /public/appointments/:token consulta apenas este campo.
   */
  index('appointments_cancellation_token_idx')
    .on(table.cancellationToken),

  /**
   * Índice para filtrar por status no dashboard do prestador.
   * Ex: "mostrar apenas agendamentos pendentes".
   */
  index('appointments_status_idx').on(table.status),

  /**
   * Índice para o job de lembrete: buscar agendamentos confirmados
   * com scheduledAt entre agora+23h e agora+25h.
   */
  index('appointments_reminder_idx').on(table.status, table.scheduledAt),

  /**
   * Necessário para permitir que a tabela de auditoria faça uma FK composta.
   * Garante a integridade multi-tenant em nível de banco de dados.
   */
  unique('appointments_id_tenant_id_key').on(table.id, table.tenantId),

  /**
   * CHAVE ESTRANGEIRA COMPOSTA (Integridade Multi-tenant):
   * Garante que o agendamento use um serviço que pertence ao MESMO tenant.
   */
  foreignKey({
    columns: [table.serviceId, table.tenantId],
    foreignColumns: [services.id, services.tenantId],
  }).onDelete('restrict'),
])

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [appointments.tenantId],
    references: [tenants.id],
  }),
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
  auditLog: many(appointmentAuditLog),
}))

/**
 * ── Máquina de Estados dos Agendamentos ──────────────────────────
 * 
 * Transições válidas:
 * - PENDING   -> CONFIRMED (tenant)
 * - PENDING   -> REJECTED  (tenant)
 * - PENDING   -> CANCELLED (ambos)
 * - CONFIRMED -> CANCELLED (ambos)
 * - CONFIRMED -> COMPLETED (system)
 * 
 * Estados finais: REJECTED, CANCELLED, COMPLETED.
 * ───────────────────────────────────────────────────────────────
 */

export type Appointment    = typeof appointments.$inferSelect
export type NewAppointment = typeof appointments.$inferInsert
