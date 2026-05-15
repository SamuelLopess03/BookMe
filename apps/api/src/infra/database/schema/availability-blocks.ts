import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tenants } from './tenants'

export const availabilityBlocks = pgTable('availability_blocks', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * Início do bloqueio (inclusive).
   * Para bloqueio de dia inteiro: meia-noite do dia bloqueado.
   * Para bloqueio parcial: hora exata de início.
   */
  startAt: timestamp('start_at', { withTimezone: true }).notNull(),

  /**
   * Fim do bloqueio (exclusive, padrão de intervalos [start, end)).
   * Para bloqueio de dia inteiro: meia-noite do dia seguinte (00:00:00).
   */
  endAt: timestamp('end_at', { withTimezone: true }).notNull(),

  /**
   * Motivo opcional visível apenas para o prestador.
   * Ex: "Férias", "Feriado municipal", "Compromisso pessoal".
   */
  reason: varchar('reason', { length: 255 }),

  /**
   * Flag de conveniência para bloqueios de dia inteiro.
   * Quando true, startAt e endAt cobrem o dia inteiro.
   * Facilita a renderização no frontend (checkbox "dia inteiro").
   */
  isFullDay: boolean('is_full_day').notNull().default(false),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('avail_blocks_tenant_id_idx').on(table.tenantId),
  /**
   * Índice composto para a query mais comum: "quais bloqueios intersectam a data X?"
   * WHERE tenant_id = ? AND start_at <= ? AND end_at >= ?
   */
  index('avail_blocks_tenant_range_idx').on(table.tenantId, table.startAt, table.endAt),
])

export const availabilityBlocksRelations = relations(availabilityBlocks, ({ one }) => ({
  tenant: one(tenants, { fields: [availabilityBlocks.tenantId], references: [tenants.id] }),
}))

export type AvailabilityBlock    = typeof availabilityBlocks.$inferSelect
export type NewAvailabilityBlock = typeof availabilityBlocks.$inferInsert
