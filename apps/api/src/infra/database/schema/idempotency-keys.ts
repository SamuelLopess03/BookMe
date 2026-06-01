import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  jsonb,
  index,
  check,
  primaryKey,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { idempotencyKeyStatusEnum } from "./enums";
import { tenants } from "./tenants";

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    /**
     * Chave de idempotência gerada pelo cliente (UUID v4 ou v7).
     * A identidade da linha é composta com `tenantId` na primary key.
     */
    key: uuid("key").notNull(),

    /**
     * Tenant ao qual a requisição pertence. Necessário para o escopo de
     * multi‑tenant e para aplicar Row‑Level Security.
     */
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    /**
     * Endpoint da API que está sendo protegido (ex.: "/api/v1/agendamentos").
     * Mantido como contexto da requisição para auditoria e resposta, mas não
     * faz parte da unicidade da chave.
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
     *
     * Observação: o banco valida essa regra com uma CHECK constraint.
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
     * PK composta para permitir a mesma key em tenants diferentes sem perder
     * a identificação única da linha.
     */
    primaryKey({
      name: "idempotency_keys_tenant_id_key_pk",
      columns: [table.tenantId, table.key],
    }),

    /**
     * Índice parcial que mantém apenas chaves completadas. Isso permite que o
     * job de limpeza (executado diariamente via BullMQ) escaneie um conjunto
     * pequeno e constante de linhas.
     */
    index("idempotency_keys_expires_at_idx")
      .on(table.expiresAt)
      .where(sql`status = 'completed'`),

    check(
      "idempotency_keys_status_response_chk",
      sql`
        (
          status = 'completed' AND response IS NOT NULL
        ) OR (
          status IN ('processing', 'failed') AND response IS NULL
        )
      `,
    ),

    pgPolicy("tenant_isolation", {
      for: "all",
      using: sql`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
      withCheck: sql`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

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
