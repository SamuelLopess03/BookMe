import { pgTable, uuid, text, integer, timestamp, index } from 'drizzle-orm/pg-core'
import { relations, isNull } from 'drizzle-orm'
import { tenants } from './tenants'

export const services = pgTable('services', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  name: text('name').notNull(),
  description: text('description'),

  /**
   * Duração do serviço em minutos inteiros.
   * Mínimo: 15 minutos (validado na camada de aplicação).
   * Usado pelo algoritmo de cálculo de slots para determinar blocos de tempo ocupados.
   */
  durationMinutes: integer('duration_minutes').notNull(),

  /**
   * Preço em centavos. Nulo = serviço sem preço definido (a definir presencialmente).
   * Ex: R$ 45,00 → 4500
   */
  priceCents: integer('price_cents'),

  /**
   * Soft delete: nulo = ativo, timestamp = momento da exclusão.
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index('services_tenant_id_idx').on(table.tenantId),
  /**
   * Índice parcial: apenas serviços ativos (não deletados).
   * Melhora a performance de listagem na página pública.
   */
  index('services_tenant_id_active_idx')
    .on(table.tenantId)
    .where(isNull(table.deletedAt)),
])

export const servicesRelations = relations(services, ({ one, many }) => ({
  tenant:       one(tenants, { fields: [services.tenantId], references: [tenants.id] }),
  /* appointments: many(appointments), */
}))

export type Service    = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert
