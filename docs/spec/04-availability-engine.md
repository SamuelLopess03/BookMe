# SDD — Motor de Disponibilidade

## BookMe · Spec Driven Development

**Documento:** `docs/specs/04-availability-engine.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `03-authentication-module.md` concluído  
**ADRs relacionados:** ADR-007 (Redis Cache), ADR-009 (Concorrência)

---

## 1. Objetivo

Este documento especifica o motor de cálculo de disponibilidade do BookMe — o algoritmo que responde à pergunta: **"Quais horários estão disponíveis para um prestador em uma data específica?"**

Este é o módulo de lógica de negócio mais complexo do sistema. O cálculo não é trivial porque envolve cruzar três fontes de dados: regras semanais recorrentes, bloqueios manuais pontuais e agendamentos já existentes. O resultado é cacheado no Redis para performance.

Ao final deste documento, você deve ser capaz de:

- Implementar o algoritmo de geração de slots disponíveis
- Compreender as regras de negócio que determinam se um slot está disponível
- Implementar a estratégia de cache-aside com invalidação ativa
- Implementar os endpoints de consulta de disponibilidade (públicos — sem autenticação)

---

## 2. Regras de Negócio

### 2.1 · O que é um "slot"?

Um slot é um intervalo de tempo disponível para agendamento. Se um prestador define que trabalha das 09h às 12h com serviços de 30 minutos e intervalo de 10 minutos entre atendimentos, os slots são:

```
09:00 → 09:30 (serviço 30min)
09:40 → 10:10 (intervalo 10min + serviço 30min)
10:20 → 10:50
11:00 → 11:30
```

O `appointmentIntervalMinutes` em `tenant_settings` define o intervalo entre o fim de um atendimento e o início do próximo. O `durationMinutes` é do serviço específico sendo agendado.

### 2.2 · Condições para um slot estar DISPONÍVEL

Um slot `(dataHora, dataHoraFim)` está disponível somente se **todas** as condições abaixo forem verdadeiras:

1. ✅ O horário está dentro de uma janela de `availability_schedules` para o dia da semana
2. ✅ O horário não conflita com nenhum `availability_block` ativo para a data
3. ✅ O horário não conflita com nenhum agendamento com status `pending` ou `confirmed`
4. ✅ A data está no futuro (respeitando `minBookingNoticeHours` do tenant)
5. ✅ A data está dentro do horizonte máximo (`maxBookingDaysAhead` do tenant)
6. ✅ O slot completo (início + duração do serviço) cabe na janela de disponibilidade

### 2.3 · Exemplo visual

```
Regra semanal (segunda): 09:00 → 12:00
Bloqueio manual:         10:30 → 11:00 (consulta particular)
Agendamento existente:   09:40 → 10:10 (confirmado)
Serviço solicitado:      30min, intervalo 10min

Slots gerados pela regra:
  09:00–09:30  ✅ DISPONÍVEL
  09:40–10:10  ❌ OCUPADO (agendamento existente)
  10:20–10:50  ❌ BLOQUEADO (conflita com bloqueio 10:30–11:00)
  11:00–11:30  ✅ DISPONÍVEL
  11:40–12:10  ❌ INVÁLIDO (ultrapassa o fim da janela 12:00)
```

---

## 3. Algoritmo de Cálculo

```typescript
// apps/api/src/modules/availability/availability.engine.ts

interface Slot {
  startTime: string; // 'HH:MM' — horário de início
  endTime: string; // 'HH:MM' — horário de fim
  available: boolean;
}

interface AvailabilityInput {
  date: string; // 'YYYY-MM-DD'
  serviceDuration: number; // minutos
  schedules: Array<{ startTime: string; endTime: string }>;
  blocks: Array<{ startsAt: Date; endsAt: Date }>;
  appointments: Array<{ scheduledAt: Date; endsAt: Date }>;
  settings: {
    appointmentIntervalMinutes: number;
    minBookingNoticeHours: number;
  };
}

export function calculateAvailableSlots(input: AvailabilityInput): Slot[] {
  const { date, serviceDuration, schedules, blocks, appointments, settings } =
    input;

  const slots: Slot[] = [];

  // Mínimo timestamp para agendamento (now + minBookingNoticeHours)
  const minAllowedTime = new Date();
  minAllowedTime.setHours(
    minAllowedTime.getHours() + settings.minBookingNoticeHours,
  );

  for (const schedule of schedules) {
    // Itera pelos slots dentro de cada janela de disponibilidade
    let current = parseTimeToDate(date, schedule.startTime);
    const windowEnd = parseTimeToDate(date, schedule.endTime);

    while (true) {
      const slotEnd = new Date(current.getTime() + serviceDuration * 60 * 1000);

      // Condição 6: slot completo deve caber na janela
      if (slotEnd > windowEnd) break;

      const available =
        // Condição 4: horário mínimo
        current >= minAllowedTime &&
        // Condição 2: sem bloqueios
        !hasConflict(
          current,
          slotEnd,
          blocks.map((b) => ({ start: b.startsAt, end: b.endsAt })),
        ) &&
        // Condição 3: sem agendamentos
        !hasConflict(
          current,
          slotEnd,
          appointments.map((a) => ({ start: a.scheduledAt, end: a.endsAt })),
        );

      slots.push({
        startTime: formatTime(current),
        endTime: formatTime(slotEnd),
        available,
      });

      // Avança para o próximo slot: duração do serviço + intervalo
      current = new Date(
        slotEnd.getTime() + settings.appointmentIntervalMinutes * 60 * 1000,
      );
    }
  }

  return slots;
}

// Verifica se [start, end) conflita com algum intervalo em [intervals]
function hasConflict(
  start: Date,
  end: Date,
  intervals: Array<{ start: Date; end: Date }>,
): boolean {
  return intervals.some(
    (interval) => start < interval.end && end > interval.start,
  );
}

function parseTimeToDate(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
}

function formatTime(date: Date): string {
  return date.toTimeString().slice(0, 5); // 'HH:MM'
}
```

---

## 4. Repository

```typescript
// apps/api/src/modules/availability/availability.repository.ts
import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "../../infra/database/client";
import {
  availabilitySchedules,
  availabilityBlocks,
  appointments,
} from "../../infra/database/schema";
import { BaseRepository } from "../../shared/repositories/base.repository";

export class AvailabilityRepository extends BaseRepository {
  async getSchedulesForDay(dayOfWeek: number) {
    return db.query.availabilitySchedules.findMany({
      where: (s, { eq, and }) =>
        and(eq(s.tenantId, this.tenantId), eq(s.dayOfWeek, dayOfWeek)),
    });
  }

  async getBlocksForDate(date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return db
      .select()
      .from(availabilityBlocks)
      .where(
        and(
          eq(availabilityBlocks.tenantId, this.tenantId),
          lte(availabilityBlocks.startsAt, endOfDay),
          gte(availabilityBlocks.endsAt, startOfDay),
        ),
      );
  }

  async getAppointmentsForDate(date: Date) {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return db
      .select({
        scheduledAt: appointments.scheduledAt,
        endsAt: appointments.endsAt,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, this.tenantId),
          gte(appointments.scheduledAt, startOfDay),
          lte(appointments.scheduledAt, endOfDay),
          // Só conta pending e confirmed para bloquear o slot
          // Rejeitados, cancelados e completados liberam o horário
        ),
      );
  }

  async getTenantSettings() {
    return db.query.tenantSettings.findFirst({
      where: (ts, { eq }) => eq(ts.tenantId, this.tenantId),
    });
  }
}
```

---

## 5. Cache-Aside com Redis

O cache usa o padrão **cache-aside com invalidação ativa**:

- Na leitura: busca no Redis; se miss, calcula e armazena
- Na escrita (criação/cancelamento de agendamento, alteração de disponibilidade): invalida o cache daquela data/tenant

```typescript
// apps/api/src/modules/availability/availability.cache.ts
import { redisCache } from "../../infra/redis/cache.client";

const CACHE_TTL = 60; // segundos

export class AvailabilityCache {
  private key(tenantId: string, date: string, serviceId: string): string {
    return `availability:${tenantId}:${date}:${serviceId}`;
  }

  async get(tenantId: string, date: string, serviceId: string) {
    const raw = await redisCache.get(this.key(tenantId, date, serviceId));
    return raw ? JSON.parse(raw) : null;
  }

  async set(
    tenantId: string,
    date: string,
    serviceId: string,
    slots: unknown[],
  ) {
    await redisCache.setEx(
      this.key(tenantId, date, serviceId),
      CACHE_TTL,
      JSON.stringify(slots),
    );
  }

  /**
   * Invalida todos os caches de disponibilidade de um tenant para uma data.
   * Chamado quando um agendamento é criado, cancelado ou a disponibilidade muda.
   */
  async invalidateDate(tenantId: string, date: string) {
    const pattern = `availability:${tenantId}:${date}:*`;
    const keys = await redisCache.keys(pattern);
    if (keys.length > 0) {
      await redisCache.del(keys);
    }
  }
}
```

---

## 6. Service

```typescript
// apps/api/src/modules/availability/availability.service.ts
import { AvailabilityRepository } from "./availability.repository";
import { AvailabilityCache } from "./availability.cache";
import { calculateAvailableSlots } from "./availability.engine";
import { NotFoundError } from "../../shared/errors/app-errors";
import { db } from "../../infra/database/client";
import { services } from "../../infra/database/schema";
import { eq, and, isNull } from "drizzle-orm";

export class AvailabilityService {
  constructor(
    private readonly tenantId: string,
    private readonly repo = new AvailabilityRepository(db, tenantId),
    private readonly cache = new AvailabilityCache(),
  ) {}

  async getSlotsForDate(date: string, serviceId: string) {
    // 1. Tenta cache hit
    const cached = await this.cache.get(this.tenantId, date, serviceId);
    if (cached) return cached;

    // 2. Cache miss — busca dados para o cálculo
    const service = await db.query.services.findFirst({
      where: (s, { eq, and, isNull }) =>
        and(
          eq(s.id, serviceId),
          eq(s.tenantId, this.tenantId),
          isNull(s.deletedAt),
        ),
    });
    if (!service) throw new NotFoundError("Serviço");

    const targetDate = new Date(date);
    const dayOfWeek = targetDate.getDay(); // 0=Dom, 1=Seg, ...

    const [schedules, blocks, existingAppointments, settings] =
      await Promise.all([
        this.repo.getSchedulesForDay(dayOfWeek),
        this.repo.getBlocksForDate(targetDate),
        this.repo.getAppointmentsForDate(targetDate),
        this.repo.getTenantSettings(),
      ]);

    if (!settings) throw new NotFoundError("Configurações do prestador");

    // 3. Calcula slots
    const slots = calculateAvailableSlots({
      date,
      serviceDuration: service.durationMinutes,
      schedules,
      blocks,
      appointments: existingAppointments,
      settings: {
        appointmentIntervalMinutes: settings.appointmentIntervalMinutes,
        minBookingNoticeHours: settings.minBookingNoticeHours,
      },
    });

    // 4. Armazena no cache
    await this.cache.set(this.tenantId, date, serviceId, slots);

    return slots;
  }

  /**
   * Retorna os dias disponíveis num intervalo (para o calendário).
   * Um dia é "disponível" se tem ao menos um slot livre.
   */
  async getAvailableDates(
    serviceId: string,
    startDate: string,
    endDate: string,
  ) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const results: Array<{ date: string; hasSlots: boolean }> = [];

    const settings = await this.repo.getTenantSettings();
    if (!settings) throw new NotFoundError("Configurações do prestador");

    const maxDate = new Date();
    maxDate.setDate(maxDate.getDate() + settings.maxBookingDaysAhead);

    let current = new Date(start);
    while (current <= end && current <= maxDate) {
      const dateStr = current.toISOString().slice(0, 10);
      const slots = await this.getSlotsForDate(dateStr, serviceId);
      results.push({
        date: dateStr,
        hasSlots: slots.some((s: { available: boolean }) => s.available),
      });
      current.setDate(current.getDate() + 1);
    }

    return results;
  }
}
```

---

## 7. Routes (Públicas — sem autenticação)

As rotas de disponibilidade são públicas: o cliente não precisa de conta para consultar horários disponíveis do prestador.

```typescript
// apps/api/src/modules/availability/availability.routes.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AvailabilityService } from "./availability.service";

const getSlotsQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de data inválido. Use YYYY-MM-DD"),
  serviceId: z.string().uuid("ID do serviço inválido"),
});

export async function availabilityRoutes(app: FastifyInstance) {
  /**
   * GET /api/v1/availability/:tenantSlug/slots?date=2025-06-15&serviceId=uuid
   * Público — retorna os slots do dia para o serviço especificado
   */
  app.get("/:tenantSlug/slots", async (request, reply) => {
    const { tenantSlug } = request.params as { tenantSlug: string };

    // Resolve tenantId pelo slug (público, sem auth)
    const tenant = await resolveTenantBySlug(tenantSlug);
    const query = getSlotsQuerySchema.parse(request.query);

    const service = new AvailabilityService(tenant.id);
    const slots = await service.getSlotsForDate(query.date, query.serviceId);

    return reply.send({ date: query.date, slots });
  });

  /**
   * GET /api/v1/availability/:tenantSlug/dates?serviceId=uuid&start=YYYY-MM-DD&end=YYYY-MM-DD
   * Público — retorna quais datas num intervalo têm ao menos um slot disponível
   */
  app.get("/:tenantSlug/dates", async (request, reply) => {
    const { tenantSlug } = request.params as { tenantSlug: string };
    const tenant = await resolveTenantBySlug(tenantSlug);

    const { serviceId, start, end } = request.query as {
      serviceId: string;
      start: string;
      end: string;
    };

    const service = new AvailabilityService(tenant.id);
    const dates = await service.getAvailableDates(serviceId, start, end);

    return reply.send({ dates });
  });
}
```

---

## 8. Quando o Cache é Invalidado

Este diagrama mostra todos os eventos que devem chamar `cache.invalidateDate()`:

```
Agendamento criado        → invalidate(tenantId, data do agendamento)
Agendamento cancelado     → invalidate(tenantId, data do agendamento)
Agendamento rejeitado     → invalidate(tenantId, data do agendamento)
Bloqueio manual criado    → invalidate(tenantId, datas cobertas pelo bloqueio)
Bloqueio manual removido  → invalidate(tenantId, datas cobertas pelo bloqueio)
Schedule semanal alterado → invalidate ALL para o tenant (todas as datas futuras)
```

A invalidação "all" usa o padrão de keys: `availability:{tenantId}:*`.

---

## 9. Checklist de Implementação

### Fase 1 — Engine pura

- [ ] **#AV-01** Implementar `availability.engine.ts` com `calculateAvailableSlots()`
- [ ] **#AV-02** Escrever testes unitários cobrindo: slot dentro da janela, slot bloqueado, slot ocupado, slot que ultrapassa a janela, `minBookingNoticeHours`

### Fase 2 — Infraestrutura

- [ ] **#AV-03** Implementar `AvailabilityRepository` com os 4 métodos de dados
- [ ] **#AV-04** Implementar `AvailabilityCache` com get/set/invalidateDate

### Fase 3 — Service e Routes

- [ ] **#AV-05** Implementar `AvailabilityService.getSlotsForDate()` com cache-aside
- [ ] **#AV-06** Implementar `AvailabilityService.getAvailableDates()` para o calendário
- [ ] **#AV-07** Implementar `availability.routes.ts` e registrar no `app.ts`

### Fase 4 — Validação

- [ ] **#AV-08** Testar: request retorna cache hit na segunda chamada (verificar com Redis CLI)
- [ ] **#AV-09** Testar: criação de agendamento invalida o cache (cache miss na chamada seguinte)
- [ ] **#AV-10** Testar: data fora do horizonte `maxBookingDaysAhead` retorna todos os slots como indisponíveis

---

## 10. Referências

- ADR-007: Redis Dual-Instance → `docs/adr/0007-redis-dual-instance.md`
- ADR-009: Race Condition em Slots → `docs/adr/0009-scheduling-concurrency-control.md`
- Spec 01: Tabelas `availability_schedules`, `availability_blocks`, `tenant_settings`
- Spec 02: `redisCache` client, `BaseRepository`
