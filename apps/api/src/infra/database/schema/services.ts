import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  index,
  uniqueIndex,
  unique,
  pgPolicy,
} from "drizzle-orm/pg-core";
import { relations, isNull, sql } from "drizzle-orm";
import { tenants } from "./tenants";

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),

    name: text("name").notNull(),
    description: text("description"),

    /**
     * Duração do serviço em minutos inteiros.
     */
    durationMinutes: integer("duration_minutes").notNull(),

    /**
     * Preço em centavos.
     */
    priceCents: integer("price_cents"),

    /**
     * Soft delete: nulo = ativo, timestamp = momento da exclusão.
     */
    deletedAt: timestamp("deleted_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("services_tenant_id_idx").on(table.tenantId),

    index("services_tenant_id_active_idx")
      .on(table.tenantId)
      .where(isNull(table.deletedAt)),

    /**
     * Garante que o prestador não tenha dois serviços ativos com o mesmo nome.
     */
    uniqueIndex("services_tenant_name_unique_idx")
      .on(table.tenantId, table.name)
      .where(isNull(table.deletedAt)),

    /**
     * Necessário para permitir que a tabela de appointments faça uma FK composta.
     * Garante integridade multi-tenant: o agendamento deve usar um serviço do MESMO tenant.
     */
    unique("services_id_tenant_id_key").on(table.id, table.tenantId),

    pgPolicy("tenant_isolation", {
      for: "all",
      using: sql`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
      withCheck: sql`tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid`,
    }),
  ],
).enableRLS();

export const servicesRelations = relations(services, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [services.tenantId],
    references: [tenants.id],
  }),
  /* appointments: many(appointments), */
}));

export type Service = typeof services.$inferSelect;
export type NewService = typeof services.$inferInsert;
