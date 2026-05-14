import { pgTable, uuid, varchar, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { tenants } from './tenants'

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * Hash SHA-256 do refresh token (o token em si nunca é armazenado).
   * O token gerado é enviado ao cliente; o hash é armazenado no banco.
   * Na validação: hash(token_recebido) === token_hash armazenado.
   * Estratégia definida no ADR-001.
   */
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  /**
   * Preenchido no logout ou quando o token é rotacionado (refresh token rotation).
   * Token com revokedAt != null é inválido, mesmo que não tenha expirado.
   */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('refresh_tokens_tenant_id_idx').on(table.tenantId),
  index('refresh_tokens_expires_at_idx').on(table.expiresAt),
])

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  tenant: one(tenants, {
    fields: [refreshTokens.tenantId],
    references: [tenants.id],
  }),
}))

export type RefreshToken    = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert
