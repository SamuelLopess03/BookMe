# SDD — Modelagem do Banco de Dados
## AgendaFácil · Spec Driven Development

**Documento:** `docs/specs/01-database-modeling.md`  
**Status:** Draft  
**Versão:** 1.0  
**Issues relacionadas:** #1 · Setup Drizzle ORM e schema inicial  

---

## 1. Objetivo

Este documento especifica de forma completa e implementável a modelagem do banco de dados relacional do AgendaFácil usando PostgreSQL 16 e Drizzle ORM. Ele serve como **fonte de verdade** para a implementação do schema, devendo ser lido antes de escrever qualquer linha de código de banco.

Ao final da leitura deste documento, você deve ser capaz de:
- Entender **por que** cada tabela e coluna existe
- Implementar o schema Drizzle sem ambiguidades
- Compreender a estratégia de multi-tenancy em nível de banco
- Saber quais índices criar e por quê
- Executar o seed inicial para desenvolvimento

---

## 2. Visão Geral das Entidades

O diagrama abaixo representa o relacionamento entre todas as entidades do sistema:

```
┌──────────────┐        ┌──────────────────┐
│    tenants   │──1:1──▶│ tenant_settings  │
│  (prestador) │        └──────────────────┘
└──────┬───────┘
       │
       │──1:N──▶┌──────────────────┐
       │        │  refresh_tokens  │
       │        └──────────────────┘
       │
       │──1:N──▶┌──────────────┐
       │        │   services   │
       │        └──────┬───────┘
       │               │
       │──1:N──▶┌──────────────────────┐
       │        │ availability_schedules│  (disponibilidade semanal recorrente)
       │        └──────────────────────┘
       │
       │──1:N──▶┌──────────────────────┐
       │        │  availability_blocks │  (bloqueios manuais pontuais)
       │        └──────────────────────┘
       │
       │──1:N──▶┌───────────────┐
                │  appointments │──N:1──▶ services
                └───────┬───────┘
                        │
                        │──1:N──▶┌──────────────────────┐
                                 │ appointment_audit_log │
                                 └──────────────────────┘
```

---

## 3. Decisões de Design Tomadas

Antes do schema, entenda as decisões que o moldam. Cada uma tem um motivo:

**3.1 · `tenants` é também a entidade de autenticação**
Não existe uma tabela `users` separada. O prestador de serviço *é* o usuário autenticado do sistema. Separar em duas tabelas (`users` + `tenant_profiles`) seria uma abstração prematura sem benefício real na v1.0.

**3.2 · `tenant_settings` é uma tabela separada, não colunas em `tenants`**
As configurações de comportamento do agendamento (`min_booking_notice_hours`, `appointment_interval_minutes`, etc.) crescerão ao longo do tempo. Mantê-las numa tabela separada evita que `tenants` se torne uma god table com 30 colunas. A relação é sempre 1:1, criada automaticamente no registro do tenant.

**3.3 · `availability_schedules` modela recorrência semanal, não datas específicas**
O prestador define "trabalho segunda das 09h às 12h e das 14h às 18h". Isso é uma regra recorrente, não um slot para cada dia do ano. O cálculo de slots disponíveis para uma data específica é feito na camada de aplicação, cruzando a regra semanal com os agendamentos já existentes e os bloqueios pontuais.

**3.4 · Soft delete via `deleted_at` em `services` e `tenants`**
Serviços e tenants nunca são deletados fisicamente para evitar "orfelenar" agendamentos históricos. Usamos a coluna `deleted_at` (timestamp) em vez de um booleano simples. Isso permite saber *quando* o registro foi removido e facilita a criação de índices parciais que ignoram dados excluídos, mantendo a performance das buscas.

**3.5 · `cancellation_token` na tabela `appointments`**
O cliente cancela um agendamento via link no e-mail, sem precisar de login. Esse link carrega um UUID único e opaco (`cancellation_token`) gerado no momento da criação do agendamento. Isso evita que o cliente precise de uma conta e mantém o fluxo de cancelamento simples e seguro.

**3.6 · `appointment_audit_log` com `tenant_id` redundante**
A coluna `tenant_id` existe no audit log mesmo sendo derivável via `appointment_id → appointments.tenant_id`. Isso é intencional: facilita a aplicação de Row-Level Security diretamente nessa tabela sem joins.

**3.7 · Timestamps sempre `withTimezone: true`**
Toda coluna de data/hora usa `TIMESTAMPTZ` (timestamp with time zone) no PostgreSQL. Isso armazena o instante em UTC e evita bugs de fuso horário — crítico para um sistema de agendamentos onde prestador e cliente podem estar em fusos diferentes.

**3.8 · Preço em centavos (`price_cents`)**
Dinheiro nunca é armazenado como `float` ou `decimal` no banco para evitar erros de ponto flutuante. O valor em centavos é um inteiro (`INTEGER`). A camada de aplicação divide por 100 para exibição. Ex: R$ 50,00 → `5000`.

**3.9 · UUID v7 para Primary Keys (Performance de Índice)**
Para tabelas de alto volume (especialmente `appointments` e `audit_log`), priorizamos o uso de UUID v7 (ou similar ordenado no tempo). Diferente do UUID v4 aleatório, o v7 mantém a localidade dos dados no índice B-tree do PostgreSQL, evitando fragmentação e garantindo que as inserções permaneçam rápidas mesmo com milhões de registros.

**3.10 · Preferência pelo tipo `text` sobre `varchar(n)`**
Seguindo as recomendações do PostgreSQL, usamos o tipo `text` para a maioria dos campos de string. No Postgres, `text` e `varchar` têm a mesma performance, mas `text` evita limites arbitrários (como o clássico 255) que podem causar erros de runtime desnecessários se os requisitos de negócio mudarem. Reservamos `varchar(n)` apenas para campos onde o limite é uma restrição de domínio rígida (ex: `slug`).

---

## 4. Enums PostgreSQL

Defina os enums antes das tabelas, pois elas os referenciam:

```typescript
// apps/api/src/infra/database/schema/enums.ts

import { pgEnum } from 'drizzle-orm/pg-core'

/**
 * Status do ciclo de vida de um agendamento.
 * Transições válidas documentadas na seção 7 deste spec.
 */
export const appointmentStatusEnum = pgEnum('appointment_status', [
  'pending',    // Criado pelo cliente, aguarda ação do prestador
  'confirmed',  // Prestador confirmou
  'rejected',   // Prestador recusou
  'cancelled',  // Cancelado por client, tenant ou system
  'completed',  // Atendimento realizado (marcado manualmente ou por job agendado)
])

/**
 * Quem iniciou o cancelamento de um agendamento.
 * Null quando o status não é 'cancelled'.
 */
export const cancelledByEnum = pgEnum('cancelled_by', [
  'client',  // Cliente cancelou via link do e-mail
  'tenant',  // Prestador cancelou pelo dashboard
  'system',  // Cancelamento automático (ex: prestador inativou o serviço)
])

/**
 * Quem provocou a mudança de status no audit log.
 */
export const changedByEnum = pgEnum('changed_by', [
  'client',
  'tenant',
  'system',
])
```

---

## 5. Schema Drizzle Completo

### 5.1 · Tabela `tenants`

```typescript
// apps/api/src/infra/database/schema/tenants.ts

import { pgTable, uuid, varchar, text, boolean, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),

  // ── Autenticação ────────────────────────────────────────
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),

  // ── Perfil público ──────────────────────────────────────
  name: text('name').notNull(),

  /**
   * Identificador único na URL pública do prestador.
   * Exemplo: "joao-barbearia" → agendafacil.com.br/joao-barbearia
   * Regras: lowercase, apenas letras, números e hífens. Sem espaços.
   * Gerado automaticamente a partir do nome no registro, editável pelo prestador.
   */
  slug: varchar('slug', { length: 100 }).notNull().unique(),

  bio: text('bio'),
  phone: varchar('phone', { length: 20 }),

  /**
   * URL da foto de perfil do prestador.
   * Armazena apenas a URL — o upload é feito em storage externo (ex: S3, Cloudflare R2).
   */
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
  settings:             one(tenantSettings),
  services:             many(services),
  refreshTokens:        many(refreshTokens),
  availabilitySchedules: many(availabilitySchedules),
  availabilityBlocks:   many(availabilityBlocks),
  appointments:         many(appointments),
}))

// ── Tipos inferidos pelo Drizzle ──────────────────────────
export type Tenant        = typeof tenants.$inferSelect
export type NewTenant     = typeof tenants.$inferInsert
export type TenantPublic  = Omit<Tenant, 'passwordHash'>
```

---

### 5.2 · Tabela `tenant_settings`

```typescript
// apps/api/src/infra/database/schema/tenant-settings.ts

import { pgTable, uuid, integer, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

export const tenantSettings = pgTable('tenant_settings', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .unique()  // garante relação 1:1
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * Mínimo de horas de antecedência que o cliente precisa ter para agendar.
   * Ex: 1 → o cliente só pode agendar se o horário for daqui a pelo menos 1h.
   * Implementa a regra RN-003.
   */
  minBookingNoticeHours: integer('min_booking_notice_hours').notNull().default(1),

  /**
   * Quantos dias no futuro o cliente pode agendar.
   * Ex: 30 → o calendário público mostra até 30 dias à frente.
   */
  maxBookingDaysAhead: integer('max_booking_days_ahead').notNull().default(30),

  /**
   * Até quantas horas antes do horário o cliente pode cancelar.
   * Ex: 2 → cliente só pode cancelar se faltarem mais de 2h para o atendimento.
   * Implementa a regra RN-004.
   */
  cancellationDeadlineHours: integer('cancellation_deadline_hours').notNull().default(2),

  /**
   * Intervalo de buffer (em minutos) adicionado após cada atendimento.
   * Garante tempo de transição entre clientes.
   * Ex: 10 → após um atendimento de 50min, o próximo slot só está disponível 60min depois.
   */
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

export type TenantSettings    = typeof tenantSettings.$inferSelect
export type NewTenantSettings = typeof tenantSettings.$inferInsert
```

---

### 5.3 · Tabela `refresh_tokens`

```typescript
// apps/api/src/infra/database/schema/refresh-tokens.ts

import { pgTable, uuid, varchar, timestamp } from 'drizzle-orm/pg-core'
import { relations, index } from 'drizzle-orm'

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),

  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * Hash SHA-256 do refresh token (o token em si nunca é armazenado).
   * O token gerado é enviado ao cliente; o hash é armazenado no banco.
   * Na validação: hash(token_recebido) === token_hash armazenado.
   */
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),

  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),

  /**
   * Preenchido no logout ou quando o token é rotacionado (refresh token rotation).
   * Token com revokedAt != null é inválido, mesmo que não tenha expirado.
   */
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('refresh_tokens_tenant_id_idx').on(table.tenantId),
  expiresAtIdx: index('refresh_tokens_expires_at_idx').on(table.expiresAt),
}))

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  tenant: one(tenants, {
    fields: [refreshTokens.tenantId],
    references: [tenants.id],
  }),
}))

export type RefreshToken    = typeof refreshTokens.$inferSelect
export type NewRefreshToken = typeof refreshTokens.$inferInsert
```

---

### 5.4 · Tabela `services`

```typescript
// apps/api/src/infra/database/schema/services.ts

import { pgTable, uuid, varchar, text, integer, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('services_tenant_id_idx').on(table.tenantId),
  /**
   * Índice parcial: apenas serviços ativos (não deletados).
   * Melhora a performance de listagem na página pública.
   */
  tenantActiveIdx: index('services_tenant_id_active_idx')
    .on(table.tenantId)
    .where(isNull(table.deletedAt)),
}))

export const servicesRelations = relations(services, ({ one, many }) => ({
  tenant:       one(tenants, { fields: [services.tenantId], references: [tenants.id] }),
  appointments: many(appointments),
}))

export type Service    = typeof services.$inferSelect
export type NewService = typeof services.$inferInsert
```

---

### 5.5 · Tabela `availability_schedules`

```typescript
// apps/api/src/infra/database/schema/availability-schedules.ts

import { pgTable, uuid, integer, time, timestamp, index, unique } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  /**
   * Um tenant não pode ter dois intervalos com o mesmo início no mesmo dia.
   * Evita duplicatas acidentais. Intervalos sobrepostos são detectados na aplicação.
   */
  uniqueTenantDayStart: unique('avail_schedules_tenant_day_start_uniq')
    .on(table.tenantId, table.dayOfWeek, table.startTime),

  tenantDayIdx: index('avail_schedules_tenant_day_idx').on(table.tenantId, table.dayOfWeek),
}))

export const availabilitySchedulesRelations = relations(availabilitySchedules, ({ one }) => ({
  tenant: one(tenants, { fields: [availabilitySchedules.tenantId], references: [tenants.id] }),
}))

export type AvailabilitySchedule    = typeof availabilitySchedules.$inferSelect
export type NewAvailabilitySchedule = typeof availabilitySchedules.$inferInsert
```

---

### 5.6 · Tabela `availability_blocks`

```typescript
// apps/api/src/infra/database/schema/availability-blocks.ts

import { pgTable, uuid, varchar, boolean, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

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
   * Fim do bloqueio (exclusive, padrão de intervalos).
   * Para bloqueio de dia inteiro: 23:59:59 ou meia-noite do dia seguinte.
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
}, (table) => ({
  tenantIdx:   index('avail_blocks_tenant_id_idx').on(table.tenantId),
  /**
   * Índice composto para a query mais comum: "quais bloqueios intersectam a data X?"
   * WHERE tenant_id = ? AND start_at <= ? AND end_at >= ?
   */
  tenantRangeIdx: index('avail_blocks_tenant_range_idx').on(table.tenantId, table.startAt, table.endAt),
}))

export const availabilityBlocksRelations = relations(availabilityBlocks, ({ one }) => ({
  tenant: one(tenants, { fields: [availabilityBlocks.tenantId], references: [tenants.id] }),
}))

export type AvailabilityBlock    = typeof availabilityBlocks.$inferSelect
export type NewAvailabilityBlock = typeof availabilityBlocks.$inferInsert
```

---

### 5.7 · Tabela `appointments` (núcleo do sistema)

```typescript
// apps/api/src/infra/database/schema/appointments.ts

import {
  pgTable, uuid, varchar, text, timestamp, index
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { appointmentStatusEnum, cancelledByEnum } from './enums'

export const appointments = pgTable('appointments', {
  id: uuid('id').primaryKey().defaultRandom(),

  // ── Multi-tenancy ─────────────────────────────────────────
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),

  // ── Dados do serviço ─────────────────────────────────────
  serviceId: uuid('service_id')
    .notNull()
    .references(() => services.id),

  // ── Dados do cliente ─────────────────────────────────────
  /**
   * O cliente NÃO tem conta no sistema.
   * Nome, e-mail e telefone são coletados no formulário de agendamento.
   * São os dados de contato para notificações e lembretes.
   */
  // ── Dados do cliente ─────────────────────────────────────
  /**
   * O cliente NÃO tem conta no sistema.
   * Nome, e-mail e telefone são coletados no formulário de agendamento.
   * São os dados de contato para notificações e lembretes.
   */
  clientName:  text('client_name').notNull(),
  clientEmail: text('client_email').notNull(),
  clientPhone: varchar('client_phone', { length: 20  }).notNull(),

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
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  tenantIdx: index('appointments_tenant_id_idx').on(table.tenantId),

  /**
   * Índice mais importante do sistema.
   * Toda query de agenda do prestador filtra por tenant + período de data.
   * Também usado no cálculo de disponibilidade.
   */
  tenantDateIdx: index('appointments_tenant_scheduled_at_idx')
    .on(table.tenantId, table.scheduledAt),

  /**
   * Índice parcial para o dashboard: agendamentos que aguardam ação.
   * Reduz o tamanho do índice pois a maioria dos registros será 'completed' ou 'cancelled'.
   */
  pendingDashboardIdx: index('appointments_pending_idx')
    .on(table.tenantId, table.scheduledAt)
    .where(eq(table.status, 'pending')),

  /**
   * Índice para lookup do token de cancelamento.
   * A rota pública DELETE /public/appointments/:token consulta apenas este campo.
   */
  cancellationTokenIdx: index('appointments_cancellation_token_idx')
    .on(table.cancellationToken),

  /**
   * Índice para filtrar por status no dashboard do prestador.
   * Ex: "mostrar apenas agendamentos pendentes".
   */
  statusIdx: index('appointments_status_idx').on(table.status),

  /**
   * Índice para o job de lembrete: buscar agendamentos confirmados
   * com scheduledAt entre agora+23h e agora+25h.
   */
  reminderIdx: index('appointments_reminder_idx').on(table.status, table.scheduledAt),
}))

export const appointmentsRelations = relations(appointments, ({ one, many }) => ({
  tenant:   one(tenants,  { fields: [appointments.tenantId],  references: [tenants.id]  }),
  service:  one(services, { fields: [appointments.serviceId], references: [services.id] }),
  auditLog: many(appointmentAuditLog),
}))

export type Appointment    = typeof appointments.$inferSelect
export type NewAppointment = typeof appointments.$inferInsert
```

---

### 5.8 · Tabela `appointment_audit_log`

```typescript
// apps/api/src/infra/database/schema/appointment-audit-log.ts

import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import { appointmentStatusEnum, changedByEnum } from './enums'

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
}, (table) => ({
  appointmentIdx: index('audit_log_appointment_id_idx').on(table.appointmentId),
  tenantIdx:      index('audit_log_tenant_id_idx').on(table.tenantId),
}))

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
```

---

### 5.9 · Arquivo de Índice do Schema

```typescript
// apps/api/src/infra/database/schema/index.ts
// Re-exporta tudo de um único ponto de entrada.

export * from './enums'
export * from './tenants'
export * from './tenant-settings'
export * from './refresh-tokens'
export * from './services'
export * from './availability-schedules'
export * from './availability-blocks'
export * from './appointments'
export * from './appointment-audit-log'
```

---

## 6. Máquina de Estados dos Agendamentos

As transições de status são a lógica de negócio mais crítica do sistema. Toda transição inválida deve ser rejeitada com erro na camada de serviço, **nunca silenciada**.

```
                    [CRIAÇÃO PELO CLIENTE]
                            │
                            ▼
                        ┌─────────┐
               ┌────────│ PENDING │────────┐
               │        └─────────┘        │
               │ Prestador confirma        │ Prestador rejeita
               ▼                           ▼
          ┌───────────┐             ┌──────────┐
          │ CONFIRMED │             │ REJECTED │  (estado final)
          └─────┬─────┘             └──────────┘
                │
      ┌─────────┼──────────────────────┐
      │         │                      │
      │ Cliente/Prestador cancela      │ Job marca como concluído
      │ (antes do horário)             │ (após o horário passar)
      ▼                                ▼
┌───────────┐                    ┌───────────┐
│ CANCELLED │  (estado final)    │ COMPLETED │  (estado final)
└───────────┘                    └───────────┘
```

### Tabela de transições válidas

| De → Para       | PENDING | CONFIRMED | REJECTED | CANCELLED | COMPLETED |
|-----------------|:-------:|:---------:|:--------:|:---------:|:---------:|
| **PENDING**     | —       | ✅ tenant | ✅ tenant | ✅ ambos  | ❌        |
| **CONFIRMED**   | ❌      | —         | ❌        | ✅ ambos  | ✅ system |
| **REJECTED**    | ❌      | ❌        | —         | ❌        | ❌        |
| **CANCELLED**   | ❌      | ❌        | ❌        | —         | ❌        |
| **COMPLETED**   | ❌      | ❌        | ❌        | ❌        | —         |

**Implementação na camada de serviço:**
```typescript
// apps/api/src/modules/appointments/appointments.service.ts

const VALID_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending:   ['confirmed', 'rejected', 'cancelled'],
  confirmed: ['cancelled', 'completed'],
  rejected:  [],
  cancelled: [],
  completed: [],
}

function assertValidTransition(from: AppointmentStatus, to: AppointmentStatus): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new InvalidStatusTransitionError(from, to)
  }
}
```

---

## 7. Estratégia Multi-tenant

### 7.1 · Camada 1 — Aplicação (BaseRepository)

Todo repositório de domínio estende um `BaseRepository` que injeta o `tenantId` automaticamente em todas as queries:

```typescript
// apps/api/src/infra/database/base.repository.ts

export abstract class BaseRepository<TTable extends PgTableWithColumns<any>> {
  constructor(
    protected readonly db: DrizzleClient,
    protected readonly table: TTable,
    protected readonly tenantId: string,
  ) {}

  /**
   * Todas as queries de leitura passam por este método.
   * Garante que o tenantId seja sempre aplicado como filtro.
   */
  protected baseQuery() {
    return this.db
      .select()
      .from(this.table)
      .where(eq((this.table as any).tenantId, this.tenantId))
  }

  /**
   * Todo insert injeta o tenantId automaticamente.
   * Nenhum repositório filho precisa (ou deve) informar tenantId manualmente.
   */
  protected withTenantId<T extends Record<string, unknown>>(data: T): T & { tenantId: string } {
    return { ...data, tenantId: this.tenantId }
  }
}
```

O `tenantId` é extraído do JWT no middleware de autenticação e injetado via contexto da requisição:

```typescript
// apps/api/src/shared/middlewares/auth.middleware.ts

fastify.addHook('preHandler', async (request) => {
  const token = extractBearerToken(request.headers.authorization)
  const payload = verifyAccessToken(token)
  request.tenantId = payload.sub  // UUID do tenant
})
```

### 7.2 · Camada 2 — Banco (PostgreSQL Row-Level Security)

RLS como segunda linha de defesa. Mesmo que haja um bug na camada de aplicação, o banco rejeita o acesso:

```sql
-- Migration: habilitar RLS nas tabelas de domínio
ALTER TABLE services              ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_blocks   ENABLE ROW LEVEL SECURITY;
ALTER TABLE appointment_audit_log ENABLE ROW LEVEL SECURITY;

-- Policy: cada tenant só vê seus próprios dados
-- A aplicação seta o parâmetro de sessão antes de cada query:
-- SET app.current_tenant_id = 'uuid-do-tenant';

CREATE POLICY tenant_isolation ON services
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

CREATE POLICY tenant_isolation ON appointments
  USING (tenant_id = current_setting('app.current_tenant_id')::uuid);

-- (mesma policy para as demais tabelas)
```

```typescript
// Na conexão Drizzle, antes de cada query autenticada:
await db.execute(
  sql`SET LOCAL app.current_tenant_id = ${tenantId}`
)
```

---

## 8. Índices — Justificativa Completa

| Índice | Tabela | Colunas | Query que justifica |
|--------|--------|---------|---------------------|
| `services_tenant_id_idx` | services | tenant_id | `GET /services` — lista serviços do tenant |
| `services_tenant_id_active_idx` | services | tenant_id | `GET /public/:slug/services` — lista apenas ativos (partial index WHERE deleted_at IS NULL) |
| `refresh_tokens_tenant_id_idx` | refresh_tokens | tenant_id | Revogação de todos os tokens no logout |
| `refresh_tokens_expires_at_idx` | refresh_tokens | expires_at | Job de limpeza de tokens expirados |
| `avail_schedules_tenant_day_idx` | availability_schedules | tenant_id, day_of_week | Cálculo de slots: "qual schedule do tenant para segunda?" |
| `avail_blocks_tenant_range_idx` | availability_blocks | tenant_id, start_at, end_at | "Há bloqueios que intersectam 2025-06-15?" |
| `appointments_tenant_scheduled_at_idx` | appointments | tenant_id, scheduled_at | Dashboard: agenda do dia/semana, cálculo de conflitos |
| `appointments_pending_idx` | appointments | tenant_id, scheduled_at | Dashboard: agendamentos pendentes (partial index) |
| `appointments_cancellation_token_idx` | appointments | cancellation_token | `DELETE /public/appointments/:token` — lookup pelo token |
| `appointments_status_idx` | appointments | status | Filtro por status no dashboard |
| `appointments_reminder_idx` | appointments | status, scheduled_at | Job de lembrete: confirmados com horário em ~24h |
| `audit_log_appointment_id_idx` | appointment_audit_log | appointment_id | Histórico de um agendamento específico |
| `audit_log_tenant_id_idx` | appointment_audit_log | tenant_id | RLS e queries de auditoria por tenant |

---

## 9. Estrutura de Arquivos para Implementação

```
apps/api/src/infra/database/
├── schema/
│   ├── index.ts                     ← Re-exporta tudo
│   ├── enums.ts                     ← pgEnum definitions
│   ├── tenants.ts
│   ├── tenant-settings.ts
│   ├── refresh-tokens.ts
│   ├── services.ts
│   ├── availability-schedules.ts
│   ├── availability-blocks.ts
│   ├── appointments.ts
│   └── appointment-audit-log.ts
│
├── migrations/                      ← Geradas pelo Drizzle Kit (não editar manualmente)
│   └── 0000_initial_schema.sql
│
├── seed/
│   ├── index.ts                     ← Orquestra o seed
│   └── seed-data.ts                 ← Dados de exemplo
│
├── drizzle.config.ts                ← Configuração do Drizzle Kit
├── client.ts                        ← Instância do cliente Drizzle (singleton)
└── base.repository.ts               ← BaseRepository com multi-tenancy
```

---

## 10. Configuração do Drizzle Kit

```typescript
// apps/api/drizzle.config.ts

import { defineConfig } from 'drizzle-kit'
import { env } from './src/shared/config/env'

export default defineConfig({
  schema:    './src/infra/database/schema/index.ts',
  out:       './src/infra/database/migrations',
  dialect:   'postgresql',
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  verbose: true,
  strict:  true,
})
```

```typescript
// apps/api/src/infra/database/client.ts

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,                    // máximo de conexões no pool
  idleTimeoutMillis: 30_000,  // fecha conexão ociosa após 30s
  connectionTimeoutMillis: 5_000,
})

export const db = drizzle(pool, { schema })
export type DrizzleClient = typeof db
```

---

## 11. Dados de Seed

O seed cria um ambiente de desenvolvimento funcional com um tenant completo e agendamentos em diferentes estados:

```typescript
// apps/api/src/infra/database/seed/seed-data.ts

export const SEED_TENANT = {
  id:           '00000000-0000-0000-0000-000000000001',
  name:         'João Silva — Barbearia',
  email:        'joao@barbearia.com',
  // senha: "senha123" (bcrypt hash)
  passwordHash: '$2b$12$...',
  slug:         'joao-barbearia',
  bio:          'Barbeiro há 10 anos, especializado em cortes modernos e barba.',
  phone:        '(85) 99999-1234',
}

export const SEED_SETTINGS = {
  tenantId:                   SEED_TENANT.id,
  minBookingNoticeHours:      1,
  maxBookingDaysAhead:        30,
  cancellationDeadlineHours:  2,
  appointmentIntervalMinutes: 10,
}

export const SEED_SERVICES = [
  { tenantId: SEED_TENANT.id, name: 'Corte masculino',   durationMinutes: 30, priceCents: 4500 },
  { tenantId: SEED_TENANT.id, name: 'Barba',             durationMinutes: 20, priceCents: 3000 },
  { tenantId: SEED_TENANT.id, name: 'Corte + Barba',     durationMinutes: 50, priceCents: 6500 },
  { tenantId: SEED_TENANT.id, name: 'Hidratação capilar', durationMinutes: 40, priceCents: 5000, deletedAt: new Date() },
]

export const SEED_SCHEDULES = [
  // Segunda a Sexta: 09h–12h e 14h–18h
  ...[1, 2, 3, 4, 5].flatMap(day => [
    { tenantId: SEED_TENANT.id, dayOfWeek: day, startTime: '09:00', endTime: '12:00' },
    { tenantId: SEED_TENANT.id, dayOfWeek: day, startTime: '14:00', endTime: '18:00' },
  ]),
  // Sábado: 09h–13h
  { tenantId: SEED_TENANT.id, dayOfWeek: 6, startTime: '09:00', endTime: '13:00' },
]
```

---

## 12. Scripts de Banco de Dados

Adicione ao `package.json` da API:

```json
{
  "scripts": {
    "db:generate": "drizzle-kit generate",
    "db:migrate":  "drizzle-kit migrate",
    "db:studio":   "drizzle-kit studio",
    "db:seed":     "tsx src/infra/database/seed/index.ts",
    "db:reset":    "tsx src/infra/database/seed/reset.ts"
  }
}
```

| Script | O que faz | Quando usar |
|--------|-----------|-------------|
| `db:generate` | Lê o schema Drizzle e gera o arquivo SQL de migration em `/migrations` | Após alterar qualquer arquivo em `schema/` |
| `db:migrate` | Aplica as migrations pendentes no banco | Após clonar o repo, após `db:generate` |
| `db:studio` | Abre o Drizzle Studio (GUI do banco no browser) | Inspecionar dados em desenvolvimento |
| `db:seed` | Popula o banco com dados de exemplo | Após `db:migrate` em ambiente dev |
| `db:reset` | Apaga todos os dados e re-executa seed | Resetar estado do banco em dev |

---

## 13. Checklist de Implementação

Use esta lista como Issues no GitHub (uma Issue por item de nível 2):

### Fase 1 — Infraestrutura base
- [ ] **#DB-01** Instalar dependências: `drizzle-orm`, `drizzle-kit`, `pg`, `@types/pg`
- [ ] **#DB-02** Criar `drizzle.config.ts` e `client.ts`
- [ ] **#DB-03** Configurar variável `DATABASE_URL` no `.env`
- [ ] **#DB-04** Verificar conexão com o PostgreSQL via Docker Compose

### Fase 2 — Schema
- [ ] **#DB-05** Criar `schema/enums.ts` com os 3 enums PostgreSQL
- [ ] **#DB-06** Criar `schema/tenants.ts` e `schema/tenant-settings.ts`
- [ ] **#DB-07** Criar `schema/refresh-tokens.ts`
- [ ] **#DB-08** Criar `schema/services.ts`
- [ ] **#DB-09** Criar `schema/availability-schedules.ts` e `schema/availability-blocks.ts`
- [ ] **#DB-10** Criar `schema/appointments.ts` e `schema/appointment-audit-log.ts`
- [ ] **#DB-11** Criar `schema/index.ts` com todos os re-exports

### Fase 3 — Migration e RLS
- [ ] **#DB-12** Rodar `pnpm db:generate` e revisar o SQL gerado
- [ ] **#DB-13** Rodar `pnpm db:migrate` e verificar tabelas criadas
- [ ] **#DB-14** Adicionar statements de `ENABLE ROW LEVEL SECURITY` e policies na migration
- [ ] **#DB-15** Implementar `BaseRepository` com injeção de `tenantId`

### Fase 4 — Seed e validação
- [ ] **#DB-16** Implementar `seed/seed-data.ts` com dados do tenant João
- [ ] **#DB-17** Implementar `seed/index.ts` e `seed/reset.ts`
- [ ] **#DB-18** Rodar `pnpm db:seed` e inspecionar dados com `pnpm db:studio`
- [ ] **#DB-19** Escrever testes de integração para o `BaseRepository` verificando isolamento multi-tenant

---

## 14. Queries de Referência

Exemplos das queries mais importantes do sistema, escritas em Drizzle:

```typescript
// ── Slots disponíveis para uma data ───────────────────────────
// Busca agendamentos confirmados ou pendentes no dia, para calcular conflitos
const existingAppointments = await db
  .select({ scheduledAt: appointments.scheduledAt, endsAt: appointments.endsAt })
  .from(appointments)
  .where(and(
    eq(appointments.tenantId, tenantId),
    gte(appointments.scheduledAt, startOfDay),
    lte(appointments.scheduledAt, endOfDay),
    inArray(appointments.status, ['pending', 'confirmed']),
  ))

// ── Agendamentos para o job de lembrete (24h) ─────────────────
const reminderTargets = await db
  .select()
  .from(appointments)
  .where(and(
    eq(appointments.status, 'confirmed'),
    gte(appointments.scheduledAt, twentyThreeHoursFromNow),
    lte(appointments.scheduledAt, twentyFiveHoursFromNow),
  ))

// ── Cancelamento via token (rota pública) ─────────────────────
const appointment = await db
  .select()
  .from(appointments)
  .where(eq(appointments.cancellationToken, tokenFromUrl))
  .limit(1)

// ── Histórico paginado do prestador (cursor-based) ────────────
const history = await db
  .select()
  .from(appointments)
  .where(and(
    eq(appointments.tenantId, tenantId),
    cursor ? lt(appointments.scheduledAt, cursorDate) : undefined,
  ))
  .orderBy(desc(appointments.scheduledAt))
  .limit(PAGE_SIZE + 1)  // +1 para saber se há próxima página
```

---

## 15. Referências

- [Drizzle ORM — PostgreSQL Docs](https://orm.drizzle.team/docs/get-started-postgresql)
- [Drizzle Kit — Migrations](https://orm.drizzle.team/kit-docs/overview)
- [PostgreSQL — Row Security Policies](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL — TIMESTAMPTZ vs TIMESTAMP](https://www.postgresql.org/docs/current/datatype-datetime.html)
- ADR-003: Multi-tenancy por Row-Level com tenant_id → `docs/adr/0003-multitenancy-row-level.md`
- ADR-005: Drizzle ORM em vez de Prisma → `docs/adr/0005-drizzle-orm.md`
