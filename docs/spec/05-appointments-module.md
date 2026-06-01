# SDD — Módulo de Agendamentos

## BookMe · Spec Driven Development

**Documento:** `docs/specs/05-appointments-module.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `04-availability-engine.md` concluído  
**ADRs relacionados:** ADR-009 (Race Condition), ADR-016 (Idempotência), ADR-008 (Contrato REST)

---

## 1. Objetivo

Este documento especifica o módulo central do BookMe: criação, gerenciamento e ciclo de vida dos agendamentos. É aqui que a lógica de negócio mais crítica reside — controle de concorrência, idempotência, máquina de estados, e paginação cursor-based do histórico.

Ao final deste documento, você deve ser capaz de:

- Implementar o fluxo completo de criação de agendamento (cliente sem conta)
- Compreender e implementar a máquina de estados dos agendamentos
- Implementar a proteção contra race condition (ADR-009)
- Implementar idempotência via `Idempotency-Key` (ADR-016)
- Implementar o cancelamento por token público (sem autenticação)
- Implementar o histórico paginado via cursor-based pagination

---

## 2. Máquina de Estados

Todo agendamento percorre um ciclo de vida definido. Transições inválidas são recusadas com erro.

```
                    ┌───────────────────────────────────────┐
                    │                                       │
              CRIAÇÃO (cliente)                             │
                    │                                       │
                    ▼                                       │
               ┌─────────┐                                  │
               │ pending │ ─── prestador confirma ──▶  ┌───────────┐
               └─────────┘                             │ confirmed │
                    │                                  └─────┬─────┘
                    │                                        │
          prestador │ rejeita                   atendimento  │ realizado
                    ▼                                        ▼
               ┌──────────┐                           ┌───────────┐
               │ rejected │                           │ completed │
               └──────────┘                           └───────────┘

Cancelamento (de qualquer estado não-terminal):
  pending   → cancelled (por: client, tenant, system)
  confirmed → cancelled (por: client, tenant, system)

Estados terminais (não podem ser alterados): rejected, completed, cancelled
```

**Transições válidas:**

| De          | Para        | Quem pode fazer                                |
| ----------- | ----------- | ---------------------------------------------- |
| `pending`   | `confirmed` | tenant (dashboard)                             |
| `pending`   | `rejected`  | tenant (dashboard)                             |
| `pending`   | `cancelled` | client (link), tenant (dashboard), system      |
| `confirmed` | `completed` | system (job agendado) ou tenant                |
| `confirmed` | `cancelled` | client (link, dentro do prazo), tenant, system |

---

## 3. Schemas Zod

```typescript
// packages/shared/schemas/appointment.schema.ts
import { z } from "zod";

export const createAppointmentSchema = z.object({
  tenantSlug: z.string().min(3),
  serviceId: z.string().uuid(),
  clientName: z.string().min(2, "Nome deve ter ao menos 2 caracteres").max(100),
  clientEmail: z.string().email("E-mail inválido"),
  clientPhone: z
    .string()
    .regex(/^\+?[1-9]\d{10,14}$/, "Telefone inválido")
    .optional(),
  scheduledAt: z.string().datetime("Data/hora inválida"),
  notes: z.string().max(500).optional(),
});

export const updateAppointmentStatusSchema = z.object({
  status: z.enum(["confirmed", "rejected", "completed", "cancelled"]),
  cancelledBy: z.enum(["client", "tenant", "system"]).optional(),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
export type UpdateAppointmentStatus = z.infer<
  typeof updateAppointmentStatusSchema
>;
```

---

## 4. Repository

```typescript
// apps/api/src/modules/appointments/appointments.repository.ts
import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../../infra/database/client";
import {
  appointments,
  appointmentAuditLog,
  idempotencyKeys,
} from "../../infra/database/schema";
import { BaseRepository } from "../../shared/repositories/base.repository";
import { randomUUID } from "crypto";

export class AppointmentRepository extends BaseRepository {
  async findById(id: string) {
    return db.query.appointments.findFirst({
      where: (a, { and, eq }) =>
        and(eq(a.id, id), eq(a.tenantId, this.tenantId)),
      with: { service: true },
    });
  }

  async findByCancellationToken(token: string) {
    // Rota pública — sem filtro de tenantId
    return db.query.appointments.findFirst({
      where: (a, { eq }) => eq(a.cancellationToken, token),
      with: { service: true },
    });
  }

  async create(data: {
    tenantId: string;
    serviceId: string;
    clientName: string;
    clientEmail: string;
    clientPhone?: string;
    scheduledAt: Date;
    endsAt: Date;
    notes?: string;
    cancellationToken: string;
  }) {
    const [appointment] = await db
      .insert(appointments)
      .values(data)
      .returning();

    return appointment;
  }

  async updateStatus(
    id: string,
    status: string,
    changedBy: string,
    cancelledBy?: string,
  ) {
    return db.transaction(async (tx) => {
      const [updated] = await tx
        .update(appointments)
        .set({
          status,
          cancelledBy: cancelledBy ?? null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(appointments.id, id),
            eq(appointments.tenantId, this.tenantId),
          ),
        )
        .returning();

      // Registra no audit log
      await tx.insert(appointmentAuditLog).values({
        tenantId: this.tenantId,
        appointmentId: id,
        previousStatus: updated.status,
        newStatus: status,
        changedBy,
      });

      return updated;
    });
  }

  /**
   * Cursor-based pagination — mais eficiente que offset/limit para tabelas grandes.
   * O cursor é a data do último agendamento retornado.
   */
  async findPaginated(options: {
    cursor?: string; // ISO datetime do último item da página anterior
    limit?: number;
    status?: string;
  }) {
    const limit = options.limit ?? 20;

    const rows = await db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, this.tenantId),
          options.cursor
            ? lt(appointments.scheduledAt, new Date(options.cursor))
            : undefined,
          options.status
            ? eq(appointments.status, options.status as any)
            : undefined,
        ),
      )
      .orderBy(desc(appointments.scheduledAt))
      .limit(limit + 1); // +1 para detectar se há próxima página

    const hasNextPage = rows.length > limit;
    const data = hasNextPage ? rows.slice(0, limit) : rows;
    const nextCursor = hasNextPage
      ? data[data.length - 1].scheduledAt.toISOString()
      : null;

    return { data, hasNextPage, nextCursor };
  }

  // ── Idempotência ─────────────────────────────────────────────

  async findIdempotencyKey(key: string) {
    return db.query.idempotencyKeys.findFirst({
      where: (ik, { eq }) => eq(ik.key, key as any),
    });
  }

  async createIdempotencyKey(key: string, tenantId: string) {
    await db.insert(idempotencyKeys).values({
      key: key as any,
      tenantId,
      endpoint: "/api/v1/appointments",
      status: "processing",
    });
  }

  async completeIdempotencyKey(key: string, response: object) {
    await db
      .update(idempotencyKeys)
      .set({ status: "completed", response })
      .where(eq(idempotencyKeys.key, key as any));
  }
}
```

---

## 5. Service com Controle de Concorrência

```typescript
// apps/api/src/modules/appointments/appointments.service.ts
import { randomUUID } from "crypto";
import { AppointmentRepository } from "./appointments.repository";
import { AvailabilityService } from "../availability/availability.service";
import { AvailabilityCache } from "../availability/availability.cache";
import { notificationQueue } from "../notifications/notification.queue";
import {
  SlotUnavailableError,
  NotFoundError,
  ConflictError,
  ForbiddenError,
} from "../../shared/errors/app-errors";
import { redisQueue } from "../../infra/redis/queue.client";
import type { CreateAppointmentInput } from "../../../packages/shared/schemas/appointment.schema";

// Duração máxima esperada de uma transação — TTL do lock Redis
const LOCK_TTL_SECONDS = 15;

export class AppointmentService {
  constructor(
    private readonly tenantId: string,
    private readonly repo = new AppointmentRepository(db, tenantId),
    private readonly availabilityCache = new AvailabilityCache(),
  ) {}

  async create(input: CreateAppointmentInput, idempotencyKey?: string) {
    // ── 1. Idempotência (ADR-016) ────────────────────────────
    if (idempotencyKey) {
      const existing = await this.repo.findIdempotencyKey(idempotencyKey);

      if (existing?.status === "completed") {
        return existing.response; // Replay do resultado original
      }
      if (existing?.status === "processing") {
        throw new ConflictError("Esta requisição já está sendo processada.");
      }

      await this.repo.createIdempotencyKey(idempotencyKey, this.tenantId);
    }

    // ── 2. Valida tenant e serviço ────────────────────────────
    const service = await getServiceById(input.serviceId, this.tenantId);
    if (!service) throw new NotFoundError("Serviço");

    const scheduledAt = new Date(input.scheduledAt);
    const endsAt = new Date(
      scheduledAt.getTime() + service.durationMinutes * 60 * 1000,
    );

    // ── 3. Redis Mutex — lock distribuído (ADR-009 Camada 1) ──
    const lockKey = `lock:slot:${this.tenantId}:${scheduledAt.toISOString()}`;
    const lockValue = randomUUID();

    const acquired = await redisQueue.set(
      lockKey,
      lockValue,
      "NX", // só cria se não existe
      "EX", // com expiração
      LOCK_TTL_SECONDS,
    );

    if (!acquired) {
      throw new SlotUnavailableError();
    }

    try {
      // ── 4. Verifica disponibilidade real no banco ─────────────
      const dateStr = scheduledAt.toISOString().slice(0, 10);
      const availSvc = new AvailabilityService(this.tenantId);
      const slots = await availSvc.getSlotsForDate(dateStr, input.serviceId);
      const targetTime = scheduledAt.toTimeString().slice(0, 5);

      const slot = slots.find((s) => s.startTime === targetTime);
      if (!slot?.available) {
        throw new SlotUnavailableError();
      }

      // ── 5. Cria o agendamento (Unique Constraint é a camada 2) ─
      const cancellationToken = randomUUID();

      const appointment = await this.repo.create({
        tenantId: this.tenantId,
        serviceId: input.serviceId,
        clientName: input.clientName,
        clientEmail: input.clientEmail,
        clientPhone: input.clientPhone,
        scheduledAt,
        endsAt,
        notes: input.notes,
        cancellationToken,
      });

      // ── 6. Invalida cache de disponibilidade ──────────────────
      await this.availabilityCache.invalidateDate(this.tenantId, dateStr);

      // ── 7. Publica jobs de notificação no BullMQ ──────────────
      await notificationQueue.add("booking-confirmed", {
        appointmentId: appointment.id,
        tenantId: this.tenantId,
      });

      await notificationQueue.add(
        "reminder-24h",
        {
          appointmentId: appointment.id,
          tenantId: this.tenantId,
        },
        {
          // Job adiado: dispara 24h antes do agendamento
          delay: scheduledAt.getTime() - Date.now() - 24 * 60 * 60 * 1000,
        },
      );

      const result = {
        id: appointment.id,
        status: appointment.status,
        scheduledAt: appointment.scheduledAt,
        cancellationToken: appointment.cancellationToken,
        service: {
          name: service.name,
          durationMinutes: service.durationMinutes,
        },
      };

      // ── 8. Finaliza chave de idempotência ─────────────────────
      if (idempotencyKey) {
        await this.repo.completeIdempotencyKey(idempotencyKey, result);
      }

      return result;
    } finally {
      // Libera o lock Redis sempre, mesmo em caso de erro
      const currentLock = await redisQueue.get(lockKey);
      if (currentLock === lockValue) {
        await redisQueue.del(lockKey);
      }
    }
  }

  async cancel(cancellationToken: string, requestedBy: "client" | "tenant") {
    const appointment =
      await this.repo.findByCancellationToken(cancellationToken);

    if (!appointment) throw new NotFoundError("Agendamento");

    // Verifica prazo de cancelamento (apenas para clientes)
    if (requestedBy === "client") {
      const settings = await getTenantSettings(appointment.tenantId);
      const deadline = new Date(appointment.scheduledAt);
      deadline.setHours(
        deadline.getHours() - (settings?.cancellationDeadlineHours ?? 2),
      );

      if (new Date() > deadline) {
        throw new ForbiddenError(
          "O prazo para cancelamento deste agendamento já expirou.",
        );
      }
    }

    // Verifica se está num estado cancelável
    if (["cancelled", "completed", "rejected"].includes(appointment.status)) {
      throw new ConflictError("Este agendamento não pode ser cancelado.");
    }

    const updated = await this.repo.updateStatus(
      appointment.id,
      "cancelled",
      requestedBy,
      requestedBy,
    );

    // Invalida cache e agenda notificação
    const dateStr = appointment.scheduledAt.toISOString().slice(0, 10);
    await this.availabilityCache.invalidateDate(appointment.tenantId, dateStr);

    await notificationQueue.add("booking-cancelled", {
      appointmentId: appointment.id,
      tenantId: appointment.tenantId,
    });

    return updated;
  }

  async updateStatus(id: string, status: string, changedBy: string) {
    const appointment = await this.repo.findById(id);
    if (!appointment) throw new NotFoundError("Agendamento");

    // Valida transição de estado
    const validTransitions: Record<string, string[]> = {
      pending: ["confirmed", "rejected", "cancelled"],
      confirmed: ["completed", "cancelled"],
    };

    const allowed = validTransitions[appointment.status] ?? [];
    if (!allowed.includes(status)) {
      throw new ConflictError(
        `Transição inválida: ${appointment.status} → ${status}`,
      );
    }

    return this.repo.updateStatus(id, status, changedBy);
  }

  async listPaginated(options: {
    cursor?: string;
    status?: string;
    limit?: number;
  }) {
    return this.repo.findPaginated(options);
  }
}
```

---

## 6. Routes

```typescript
// apps/api/src/modules/appointments/appointments.routes.ts
import type { FastifyInstance } from "fastify";
import { authenticate } from "../../infra/http/middlewares/authenticate";
import { AppointmentService } from "./appointments.service";
import { createAppointmentSchema } from "../../../packages/shared/schemas/appointment.schema";

export async function appointmentRoutes(app: FastifyInstance) {
  /**
   * POST /api/v1/appointments
   * Público — cliente cria um agendamento sem conta
   * Header opcional: Idempotency-Key: <uuid>
   */
  app.post("/", async (request, reply) => {
    const input = createAppointmentSchema.parse(request.body);
    const idempotencyKey = request.headers["idempotency-key"] as
      | string
      | undefined;

    // Resolve tenantId pelo slug
    const tenant = await resolveTenantBySlug(input.tenantSlug);
    const service = new AppointmentService(tenant.id);
    const result = await service.create(input, idempotencyKey);

    return reply.status(201).send(result);
  });

  /**
   * GET /api/v1/appointments
   * Protegido — histórico paginado do prestador autenticado
   */
  app.get(
    "/",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { cursor, status, limit } = request.query as {
        cursor?: string;
        status?: string;
        limit?: string;
      };

      const service = new AppointmentService(request.user.tenantId);
      const result = await service.listPaginated({
        cursor,
        status,
        limit: limit ? parseInt(limit) : undefined,
      });

      return reply.send(result);
    },
  );

  /**
   * PATCH /api/v1/appointments/:id/status
   * Protegido — prestador confirma, rejeita ou conclui agendamento
   */
  app.patch(
    "/:id/status",
    {
      preHandler: [authenticate],
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const { status } = request.body as { status: string };

      const service = new AppointmentService(request.user.tenantId);
      const result = await service.updateStatus(id, status, "tenant");

      return reply.send(result);
    },
  );

  /**
   * POST /api/v1/appointments/cancel/:token
   * Público — cliente cancela via link do e-mail (sem autenticação)
   */
  app.post("/cancel/:token", async (request, reply) => {
    const { token } = request.params as { token: string };

    // tenantId não é necessário aqui — o token identifica o agendamento
    const service = new AppointmentService("");
    const result = await service.cancel(token, "client");

    return reply.send({
      message: "Agendamento cancelado com sucesso.",
      status: result.status,
    });
  });
}
```

---

## 7. Resposta da API — Formatos

**Criação (201 Created):**

```json
{
  "id": "uuid",
  "status": "pending",
  "scheduledAt": "2025-06-15T14:00:00Z",
  "cancellationToken": "uuid",
  "service": {
    "name": "Corte masculino",
    "durationMinutes": 30
  }
}
```

**Listagem paginada (cursor-based):**

```json
{
  "data": [...],
  "hasNextPage": true,
  "nextCursor": "2025-06-10T09:00:00.000Z"
}
```

**Uso do cursor na próxima página:**

```
GET /api/v1/appointments?cursor=2025-06-10T09:00:00.000Z&limit=20
```

---

## 8. Checklist de Implementação

### Fase 1 — Schema e Repository

- [ ] **#APT-01** Implementar schemas Zod em `packages/shared/schemas/appointment.schema.ts`
- [ ] **#APT-02** Implementar `AppointmentRepository` com todos os métodos
- [ ] **#APT-03** Testar `findPaginated` com cursor e verificar que não há "page drift"

### Fase 2 — Service Core

- [ ] **#APT-04** Implementar `AppointmentService.create()` com lock Redis (ADR-009 Camada 1)
- [ ] **#APT-05** Testar race condition: duas requisições simultâneas para o mesmo slot → apenas uma deve ser criada
- [ ] **#APT-06** Testar idempotência: duas requisições com o mesmo `Idempotency-Key` → segunda retorna o mesmo resultado

### Fase 3 — Ciclo de Vida

- [ ] **#APT-07** Implementar `AppointmentService.cancel()` com verificação de prazo
- [ ] **#APT-08** Implementar `AppointmentService.updateStatus()` com validação de transições
- [ ] **#APT-09** Testar todas as transições inválidas (ex: `completed → confirmed`) retornam 409

### Fase 4 — Routes e integração

- [ ] **#APT-10** Implementar `appointments.routes.ts` e registrar no `app.ts`
- [ ] **#APT-11** Verificar que cancelamento via token público funciona sem Authorization header
- [ ] **#APT-12** Verificar que audit log é criado em cada mudança de status
- [ ] **#APT-13** Verificar que cache de disponibilidade é invalidado após criação e cancelamento

---

## 9. Referências

- ADR-009: Controle de Concorrência → `docs/adr/0009-scheduling-concurrency-control.md`
- ADR-016: Idempotência → `docs/adr/0016-request-idempotency.md`
- Spec 04: `AvailabilityService`, `AvailabilityCache` → `docs/specs/04-availability-engine.md`
- Spec 06: `notificationQueue` (jobs publicados aqui) → `docs/specs/06-notifications-jobs.md`
