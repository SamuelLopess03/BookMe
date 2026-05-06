import { pgTable, uuid, varchar, text, timestamp, integer } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ── Tabela Principal: Tenants ──────────────────────────────

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),

  // ── Autenticação ────────────────────────────────────────
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),

  // ── Perfil público ──────────────────────────────────────
  name: text('name').notNull(),

  /**
   * Identificador único na URL pública do prestador.
   * Exemplo: "joao-barbearia" → bookme.com.br/joao-barbearia
   * Regras: lowercase, apenas letras, números e hífens. Sem espaços.
   */
  slug: varchar('slug', { length: 100 }).notNull().unique(),

  bio: text('bio'),
  phone: varchar('phone', { length: 20 }),
  avatarUrl: text('avatar_url'),

  // ── Controle ────────────────────────────────────────────
  /**
   * Soft delete: nulo = ativo, timestamp = momento da exclusão.
   */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tenantsRelations = relations(tenants, ({ one, many }) => ({
  settings: one(tenantSettings),
  /* 
    Relações futuras:
    services:             many(services),
    refreshTokens:        many(refreshTokens),
    availabilitySchedules: many(availabilitySchedules),
    availabilityBlocks:   many(availabilityBlocks),
    appointments:         many(appointments),
  */
}))

// ── Tabela Relacionada: Tenant Settings ────────────────────

export const tenantSettings = pgTable('tenant_settings', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .unique()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /** Mínimo de horas de antecedência para agendamento (RN-003) */
  minBookingNoticeHours: integer('min_booking_notice_hours').notNull().default(1),

  /** Quantos dias no futuro o cliente pode agendar */
  maxBookingDaysAhead: integer('max_booking_days_ahead').notNull().default(30),

  /** Horas mínimas para cancelamento (RN-004) */
  cancellationDeadlineHours: integer('cancellation_deadline_hours').notNull().default(2),

  /** Intervalo de buffer entre atendimentos */
  appointmentIntervalMinutes: integer('appointment_interval_minutes').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const tenantSettingsRelations = relations(tenantSettings, ({ one }) => ({
  tenant: one(tenants, {
    fields: [tenantSettings.tenantId],
    references: [tenants.id],
  }),
}))

// ── Tipos inferidos ───────────────────────────────────────

export type Tenant        = typeof tenants.$inferSelect
export type NewTenant     = typeof tenants.$inferInsert
export type TenantPublic  = Omit<Tenant, 'passwordHash'>

export type TenantSettings    = typeof tenantSettings.$inferSelect
export type NewTenantSettings = typeof tenantSettings.$inferInsert
