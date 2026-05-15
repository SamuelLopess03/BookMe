import { pgTable, uuid, integer, time, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tenants } from './tenants'

export const availabilitySchedules = pgTable('availability_schedules', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * Dia da semana segundo padrão JavaScript/ISO:
   * 0 = Domingo, 1 = Segunda, 2 = Terça, 3 = Quarta,
   * 4 = Quinta, 5 = Sexta, 6 = Sábado
   *
   * Um prestador pode ter múltiplos intervalos por dia.
   * Ex: Segunda 09:00–12:00 e Segunda 14:00–18:00 = 2 registros com dayOfWeek=1.
   */
  dayOfWeek: integer('day_of_week').notNull(),

  /**
   * Hora de início do período de atendimento.
   * Formato: HH:mm (ex: "09:00", "14:30")
   * Drizzle mapeia para o tipo TIME do PostgreSQL.
   */
  startTime: time('start_time').notNull(),

  /**
   * Hora de fim do período de atendimento.
   * Invariante: endTime > startTime (validado na aplicação).
   */
  endTime: time('end_time').notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  /**
   * Um tenant não pode ter dois intervalos com o mesmo início no mesmo dia.
   * Evita duplicatas acidentais. Intervalos sobrepostos são detectados na aplicação.
   */
  unique('avail_schedules_tenant_day_start_uniq').on(table.tenantId, table.dayOfWeek, table.startTime),
  index('avail_schedules_tenant_day_idx').on(table.tenantId, table.dayOfWeek),
])

export const availabilitySchedulesRelations = relations(availabilitySchedules, ({ one }) => ({
  tenant: one(tenants, { fields: [availabilitySchedules.tenantId], references: [tenants.id] }),
}))

export type AvailabilitySchedule    = typeof availabilitySchedules.$inferSelect
export type NewAvailabilitySchedule = typeof availabilitySchedules.$inferInsert
