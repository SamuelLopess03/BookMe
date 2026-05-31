import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idempotencyKeyStatusEnum } from "./enums";
import { tenants } from "./tenants";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /**
     * Chave única gerada pelo cliente (UUID v4 ou v7). É a primary key
     * da tabela, pois não precisamos de um surrogate id adicional.
     */
    key: uuid("key").primaryKey(),

    /**
     * Tenant ao qual a requisição pertence. Necessário para o escopo de
     * multi‑tenant e para aplicar Row‑Level Security.
     */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    /**
     * Endpoint da API que está sendo protegido (ex.: "/api/v1/agendamentos").
     * Mantido para permitir que o mesmo tenant tenha diferentes chaves por
     * endpoint, caso necessário.
     */
    endpoint: varchar("endpoint", { length: 200 }).notNull(),

    /**
     * Estado da execução da requisição.
     */
    status: idempotencyKeyStatusEnum("status").notNull(),

    /**
     * Resposta JSON da requisição original. Armazenado apenas quando o
     * status é "completed" – permite que um request idempotente retorne o
     * mesmo payload sem refazer a lógica de negócio.
     */
    response: jsonb("response"),

    /**
     * Marca quando a chave foi criada – usado para auditoria e para calcular
     * TTLs.
     */
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /**
     * Quando a chave pode ser removida com segurança. Normalmente 24‑48h
     * após a conclusão da requisição.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    /**
     * Índice parcial que mantém apenas chaves completadas. Isso permite que o
     * job de limpeza (executado diariamente via BullMQ) escaneie um conjunto
     * pequeno e constante de linhas.
     */
    index("idempotency_keys_expires_at_idx")
      .on(table.expiresAt)
      .where(sql`status = 'completed'`),
  ],
);

export const idempotencyKeysRelations = relations(
  idempotencyKeys,
  ({ one }) => ({
    tenant: one(tenants, {
      fields: [idempotencyKeys.tenantId],
      references: [tenants.id],
    }),
  }),
);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type NewIdempotencyKey = typeof idempotencyKeys.$inferInsert;
