# SDD — Estratégia de Testes

## BookMe · Spec Driven Development

**Documento:** `docs/specs/11-testing-strategy.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** todos os specs de módulo (03–10) concluídos  
**ADRs relacionados:** ADR-014 (Pirâmide de Testes), ADR-011 (Zod Shared)

---

## 1. Objetivo

Este documento especifica a estratégia de testes do BookMe: o que testar em cada camada, como estruturar os arquivos de teste, como configurar o ambiente isolado, e quais são os testes considerados críticos (que nunca devem ser removidos).

A filosofia central é pragmática: **testar o comportamento que importa, não a implementação que muda.** Um teste que quebra a cada refatoração interna é um peso, não um ativo.

---

## 2. A Pirâmide de Testes do BookMe

```
         ╔══════════╗
         ║    E2E   ║  ← 3–5 fluxos críticos completos
         ╚══════════╝
        ╔═════════════╗
        ║  Integração ║ ← Repositories, Workers, API handlers
        ╚═════════════╝
       ╔══════════════╗
       ║   Unitários  ║ ← Schemas, Engine, Utils, Factories
       ╚══════════════╝
```

| Camada     | Quantidade       | Velocidade       | O que testa                      |
| ---------- | ---------------- | ---------------- | -------------------------------- |
| Unitários  | Muitos (~60%)    | < 1s por suite   | Lógica pura isolada              |
| Integração | Moderados (~35%) | 2–10s por suite  | Módulos com dependências reais   |
| E2E        | Poucos (~5%)     | 10–30s por suite | Fluxos críticos de ponta a ponta |

---

## 3. Configuração do Ambiente de Testes

### 3.1 · Vitest — configuração raiz

```typescript
// apps/api/vitest.config.ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true, // describe, it, expect sem import
    environment: "node",
    setupFiles: ["./src/tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.d.ts", "src/infra/database/seed/**"],
      thresholds: {
        branches: 75,
        functions: 80,
        lines: 80,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
```

```typescript
// apps/api/src/tests/setup.ts
import { beforeAll, afterAll, beforeEach } from "vitest";
import { db } from "../infra/database/client";
import { runMigrations, truncateAllTables } from "./helpers/database";

beforeAll(async () => {
  // Garante que as migrations estão atualizadas no banco de teste
  await runMigrations();
});

beforeEach(async () => {
  // Limpa todas as tabelas antes de cada teste de integração
  // Testes unitários não acessam banco e esse overhead é mínimo
  await truncateAllTables();
});

afterAll(async () => {
  await db.$client.end(); // fecha o pool de conexões
});
```

### 3.2 · Variáveis de ambiente para testes

```bash
# apps/api/.env.test
NODE_ENV=test
DATABASE_URL=postgresql://bookme_test:bookme_test@localhost:5433/bookme_test
REDIS_CACHE_URL=redis://localhost:6381
REDIS_QUEUE_URL=redis://localhost:6381
JWT_SECRET=test-secret-com-pelo-menos-32-caracteres-aqui
API_URL=http://localhost:3333
WEB_URL=http://localhost:5173
```

### 3.3 · Helpers de banco de dados

```typescript
// apps/api/src/tests/helpers/database.ts
import { db } from "../../infra/database/client";
import { sql } from "drizzle-orm";
import * as schema from "../../infra/database/schema";

export async function runMigrations() {
  // O Drizzle aplica migrations pendentes
  // Em CI, o banco de teste já está vazio
}

export async function truncateAllTables() {
  // Trunca na ordem correta (filhos antes dos pais por FK)
  await db.execute(sql`
    TRUNCATE TABLE
      appointment_audit_log,
      idempotency_keys,
      appointments,
      availability_blocks,
      availability_schedules,
      services,
      refresh_tokens,
      tenant_settings,
      tenants
    RESTART IDENTITY CASCADE
  `);
}

/**
 * Factory de dados de teste — cria um tenant completo e pronto para uso.
 * Use em testes de integração para ter um estado inicial consistente.
 */
export async function createTestTenant(
  overrides?: Partial<{
    name: string;
    email: string;
    slug: string;
  }>,
) {
  const data = {
    name: overrides?.name ?? "Prestador Teste",
    email: overrides?.email ?? `teste-${Date.now()}@bookme.com.br`,
    slug: overrides?.slug ?? `prestador-${Date.now()}`,
    passwordHash: "$2b$12$testHashFixoParaTestes.usarNuncaEmProducao",
  };

  const [tenant] = await db.insert(schema.tenants).values(data).returning();

  await db.insert(schema.tenantSettings).values({
    tenantId: tenant.id,
    minBookingNoticeHours: 1,
    maxBookingDaysAhead: 30,
    cancellationDeadlineHours: 2,
    appointmentIntervalMinutes: 10,
  });

  return tenant;
}

export async function createTestService(
  tenantId: string,
  overrides?: Partial<{
    name: string;
    durationMinutes: number;
    priceCents: number;
  }>,
) {
  const [service] = await db
    .insert(schema.services)
    .values({
      tenantId,
      name: overrides?.name ?? "Serviço Teste",
      durationMinutes: overrides?.durationMinutes ?? 30,
      priceCents: overrides?.priceCents ?? 5000,
    })
    .returning();

  return service;
}
```

---

## 4. Testes Unitários

### 4.1 · Motor de Disponibilidade (100% obrigatório)

```typescript
// apps/api/src/modules/availability/availability.engine.test.ts
import { describe, it, expect } from "vitest";
import { calculateAvailableSlots } from "./availability.engine";

const BASE_INPUT = {
  date: "2025-06-16", // Segunda-feira
  serviceDuration: 30,
  schedules: [{ startTime: "09:00", endTime: "12:00" }],
  blocks: [],
  appointments: [],
  settings: {
    appointmentIntervalMinutes: 10,
    minBookingNoticeHours: 0, // 0 para facilitar testes
  },
};

describe("calculateAvailableSlots", () => {
  it("gera slots dentro da janela de disponibilidade", () => {
    const slots = calculateAvailableSlots(BASE_INPUT);

    // 09:00–09:30, 09:40–10:10, 10:20–10:50, 11:00–11:30
    expect(slots).toHaveLength(4);
    expect(slots[0]).toEqual({
      startTime: "09:00",
      endTime: "09:30",
      available: true,
    });
    expect(slots[3]).toEqual({
      startTime: "11:00",
      endTime: "11:30",
      available: true,
    });
  });

  it("não gera slot que ultrapassa o fim da janela", () => {
    const slots = calculateAvailableSlots({
      ...BASE_INPUT,
      schedules: [{ startTime: "11:50", endTime: "12:00" }],
    });

    // 11:50 + 30min = 12:20 → ultrapassa 12:00
    expect(slots).toHaveLength(0);
  });

  it("marca slot como indisponível quando há agendamento conflitante", () => {
    const slots = calculateAvailableSlots({
      ...BASE_INPUT,
      appointments: [
        {
          scheduledAt: new Date("2025-06-16T09:00:00"),
          endsAt: new Date("2025-06-16T09:30:00"),
        },
      ],
    });

    expect(slots[0].startTime).toBe("09:00");
    expect(slots[0].available).toBe(false);
    expect(slots[1].available).toBe(true); // 09:40 ainda disponível
  });

  it("marca slot como indisponível quando há bloqueio manual conflitante", () => {
    const slots = calculateAvailableSlots({
      ...BASE_INPUT,
      blocks: [
        {
          startsAt: new Date("2025-06-16T09:30:00"),
          endsAt: new Date("2025-06-16T10:15:00"),
        },
      ],
    });

    expect(slots[0].available).toBe(true); // 09:00 não conflita
    expect(slots[1].available).toBe(false); // 09:40–10:10 conflita com bloqueio 09:30–10:15
  });

  it("respeita minBookingNoticeHours — não oferece slots muito próximos do agora", () => {
    // Cria um horário 30min no futuro
    const now = new Date();
    const soonDate = now.toISOString().slice(0, 10);
    const soonHour = String(now.getHours()).padStart(2, "0");
    const soonMinutes = now.getMinutes() < 30 ? "00" : "30";

    const slots = calculateAvailableSlots({
      ...BASE_INPUT,
      date: soonDate,
      settings: { ...BASE_INPUT.settings, minBookingNoticeHours: 2 },
    });

    // Todos os slots antes de agora + 2h devem ser indisponíveis
    const availableSlots = slots.filter((s) => s.available);
    availableSlots.forEach((slot) => {
      const [h, m] = slot.startTime.split(":").map(Number);
      const slotDate = new Date(soonDate);
      slotDate.setHours(h, m);
      const minAllowed = new Date();
      minAllowed.setHours(minAllowed.getHours() + 2);
      expect(slotDate >= minAllowed).toBe(true);
    });
  });

  it("combina múltiplas janelas do dia", () => {
    const slots = calculateAvailableSlots({
      ...BASE_INPUT,
      schedules: [
        { startTime: "09:00", endTime: "12:00" },
        { startTime: "14:00", endTime: "17:00" },
      ],
    });

    const startTimes = slots.map((s) => s.startTime);
    expect(startTimes).toContain("09:00");
    expect(startTimes).toContain("14:00");
    expect(startTimes).not.toContain("12:00"); // gap do almoço
  });
});
```

### 4.2 · Schemas Zod

```typescript
// packages/shared/schemas/appointment.schema.test.ts
import { describe, it, expect } from "vitest";
import { createAppointmentSchema } from "./appointment.schema";

describe("createAppointmentSchema", () => {
  const VALID = {
    tenantSlug: "joao-barbearia",
    serviceId: "00000000-0000-0000-0000-000000000001",
    clientName: "Maria Silva",
    clientEmail: "maria@exemplo.com.br",
    scheduledAt: "2025-12-20T10:00:00Z",
  };

  it("aceita input válido", () => {
    expect(() => createAppointmentSchema.parse(VALID)).not.toThrow();
  });

  it("rejeita email inválido", () => {
    const result = createAppointmentSchema.safeParse({
      ...VALID,
      clientEmail: "nao-e-email",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toContain("clientEmail");
  });

  it("rejeita nome com menos de 2 caracteres", () => {
    const result = createAppointmentSchema.safeParse({
      ...VALID,
      clientName: "A",
    });
    expect(result.success).toBe(false);
  });

  it("rejeita serviceId que não é UUID", () => {
    const result = createAppointmentSchema.safeParse({
      ...VALID,
      serviceId: "nao-e-uuid",
    });
    expect(result.success).toBe(false);
  });
});
```

---

## 5. Testes de Integração

### 5.1 · Repository com banco de teste real

```typescript
// apps/api/src/modules/appointments/appointments.repository.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { AppointmentRepository } from "./appointments.repository";
import {
  createTestTenant,
  createTestService,
} from "../../tests/helpers/database";

describe("AppointmentRepository", () => {
  let tenantA: any;
  let tenantB: any;

  beforeEach(async () => {
    tenantA = await createTestTenant({ slug: "tenant-a" });
    tenantB = await createTestTenant({ slug: "tenant-b" });
  });

  describe("Isolamento multi-tenant (CRÍTICO)", () => {
    it("não retorna agendamentos de outro tenant", async () => {
      const serviceA = await createTestService(tenantA.id);
      const serviceB = await createTestService(tenantB.id);

      // Cria agendamento para tenantA
      const repoA = new AppointmentRepository(null as any, tenantA.id);
      await repoA.create({
        tenantId: tenantA.id,
        serviceId: serviceA.id,
        clientName: "Cliente do Tenant A",
        clientEmail: "clienteA@teste.com",
        scheduledAt: new Date("2025-12-20T10:00:00Z"),
        endsAt: new Date("2025-12-20T10:30:00Z"),
        cancellationToken: "token-a",
      });

      // Busca com tenantB — não deve retornar nada
      const repoB = new AppointmentRepository(null as any, tenantB.id);
      const result = await repoB.findPaginated({});

      expect(result.data).toHaveLength(0);
    });
  });

  describe("Paginação cursor-based", () => {
    it("retorna a quantidade correta de itens e indica próxima página", async () => {
      const service = await createTestService(tenantA.id);
      const repo = new AppointmentRepository(null as any, tenantA.id);

      // Cria 25 agendamentos
      for (let i = 0; i < 25; i++) {
        const date = new Date(
          `2025-12-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        );
        await repo.create({
          tenantId: tenantA.id,
          serviceId: service.id,
          clientName: `Cliente ${i}`,
          clientEmail: `cliente${i}@teste.com`,
          scheduledAt: date,
          endsAt: new Date(date.getTime() + 30 * 60 * 1000),
          cancellationToken: `token-${i}`,
        });
      }

      // Primeira página
      const page1 = await repo.findPaginated({ limit: 20 });
      expect(page1.data).toHaveLength(20);
      expect(page1.hasNextPage).toBe(true);
      expect(page1.nextCursor).not.toBeNull();

      // Segunda página (usando cursor)
      const page2 = await repo.findPaginated({
        cursor: page1.nextCursor!,
        limit: 20,
      });
      expect(page2.data).toHaveLength(5);
      expect(page2.hasNextPage).toBe(false);
    });
  });
});
```

### 5.2 · API Handler com Fastify inject

```typescript
// apps/api/src/modules/auth/auth.routes.test.ts
import { describe, it, expect } from "vitest";
import { buildApp } from "../../app";
import type { FastifyInstance } from "fastify";

describe("POST /api/v1/auth/login", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("retorna 401 com mensagem vaga para credenciais inválidas", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "naoexiste@bookme.com.br", password: "qualquercoisa" },
    });

    expect(response.statusCode).toBe(401);

    const body = JSON.parse(response.body);
    // Verifica formato RFC 7807
    expect(body).toMatchObject({
      type: expect.stringContaining("unauthorized"),
      status: 401,
      title: "Não autorizado",
    });
    // Verifica que não revela se o e-mail existe
    expect(body.detail).toBe("Credenciais inválidas.");
  });

  it("retorna 422 no formato correto para input inválido", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "nao-e-email", password: "" },
    });

    expect(response.statusCode).toBe(422);

    const body = JSON.parse(response.body);
    expect(body.type).toContain("validation");
    expect(body.errors).toBeInstanceOf(Array);
    expect(body.errors.some((e: any) => e.field === "email")).toBe(true);
  });
});
```

### 5.3 · Worker de Notificações

```typescript
// apps/api/src/modules/notifications/notification.worker.test.ts
import { describe, it, expect, vi } from "vitest";
import { MockNotificationProvider } from "./providers/mock.provider";
import { NotificationFactory } from "./providers/notification.factory";

describe("NotificationFactory", () => {
  it("retorna MockProvider em NODE_ENV=test", () => {
    process.env.NODE_ENV = "test";
    const provider = NotificationFactory.create();
    expect(provider).toBeInstanceOf(MockNotificationProvider);
  });

  it("MockProvider acumula mensagens enviadas para asserções de teste", async () => {
    const mock = new MockNotificationProvider();

    await mock.send({
      to: "cliente@teste.com",
      template: "booking-confirmed",
      data: { clientName: "Maria", serviceName: "Corte" },
    });

    expect(mock.sent).toHaveLength(1);
    expect(mock.sent[0].template).toBe("booking-confirmed");
    expect(mock.sent[0].to).toBe("cliente@teste.com");
  });
});
```

---

## 6. Testes de Componente (Frontend)

### 6.1 · Configuração Vitest para o Frontend

```typescript
// apps/web/vitest.config.ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/tests/setup.ts"],
  },
});
```

```typescript
// apps/web/src/tests/setup.ts
import "@testing-library/jest-dom";
import { server } from "./mocks/server";

// MSW: intercepta chamadas HTTP nos testes
beforeAll(() => server.listen({ onUnhandledRequest: "warn" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

### 6.2 · Mock Service Worker (MSW)

```typescript
// apps/web/src/tests/mocks/handlers.ts
import { http, HttpResponse } from "msw";

export const handlers = [
  http.post("/api/v1/auth/login", async ({ request }) => {
    const body = (await request.json()) as any;

    if (
      body.email === "prestador@bookme.com.br" &&
      body.password === "Senha123"
    ) {
      return HttpResponse.json({
        accessToken: "mock-access-token",
        tenant: {
          id: "tenant-uuid",
          name: "Prestador Teste",
          email: "prestador@bookme.com.br",
          slug: "prestador-teste",
        },
      });
    }

    return HttpResponse.json(
      {
        type: "https://bookme.com.br/errors/unauthorized",
        status: 401,
        title: "Não autorizado",
        detail: "Credenciais inválidas.",
      },
      { status: 401 },
    );
  }),

  http.get("/api/v1/appointments", () => {
    return HttpResponse.json({
      data: [],
      hasNextPage: false,
      nextCursor: null,
    });
  }),
];
```

### 6.3 · Teste de formulário de login

```tsx
// apps/web/src/routes/_auth/login.test.tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginPage } from "./login";
import { TestProviders } from "../../tests/helpers/providers";

describe("LoginPage", () => {
  it("exibe erro de validação para e-mail inválido", async () => {
    render(<LoginPage />, { wrapper: TestProviders });

    await userEvent.type(screen.getByLabelText("E-mail"), "nao-e-email");
    await userEvent.type(screen.getByLabelText("Senha"), "qualquercoisa");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByText("E-mail inválido")).toBeInTheDocument();
  });

  it("exibe mensagem de erro da API para credenciais incorretas", async () => {
    render(<LoginPage />, { wrapper: TestProviders });

    await userEvent.type(
      screen.getByLabelText("E-mail"),
      "errado@bookme.com.br",
    );
    await userEvent.type(screen.getByLabelText("Senha"), "SenhaErrada1");
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(
      await screen.findByText("Credenciais inválidas."),
    ).toBeInTheDocument();
  });

  it("não permite submit com campos vazios", async () => {
    render(<LoginPage />, { wrapper: TestProviders });

    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));

    expect(screen.getByRole("button", { name: "Entrar" })).toBeDisabled();
  });
});
```

---

## 7. Testes Críticos — Nunca Remover

Os testes abaixo cobrem os riscos mais sérios do sistema. Devem sempre existir e sempre passar:

| Teste                                             | Arquivo                           | Risco coberto                              |
| ------------------------------------------------- | --------------------------------- | ------------------------------------------ |
| Isolamento multi-tenant                           | `appointments.repository.test.ts` | Vazamento de dados entre prestadores       |
| Race condition no agendamento                     | `appointments.service.test.ts`    | Duplo agendamento no mesmo slot            |
| Formato RFC 7807 nos erros                        | `auth.routes.test.ts`             | Contrato quebrado com o frontend           |
| Cálculo de slots — slot que ultrapassa janela     | `availability.engine.test.ts`     | Bug silencioso no motor de disponibilidade |
| MockProvider em NODE_ENV=test                     | `notification.worker.test.ts`     | Envio acidental de e-mails reais em CI     |
| Idempotência — mesmo resultado na segunda chamada | `appointments.service.test.ts`    | Agendamentos duplicados por retry          |

---

## 8. Scripts de Teste

```json
// package.json raiz
{
  "scripts": {
    "test": "vitest run --reporter=verbose",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "test:ui": "vitest --ui",
    "test:api": "vitest run --project=api",
    "test:web": "vitest run --project=web"
  }
}
```

---

## 9. Checklist de Implementação

### Fase 1 — Infraestrutura de testes

- [ ] **#TEST-01** Configurar `vitest.config.ts` na API com coverage e setup file
- [ ] **#TEST-02** Implementar `tests/helpers/database.ts` com factories `createTestTenant` e `createTestService`
- [ ] **#TEST-03** Configurar `docker-compose.test.yml` e garantir que `pnpm test` usa `DATABASE_URL` de teste
- [ ] **#TEST-04** Configurar Vitest + jsdom no frontend com `@testing-library/jest-dom`
- [ ] **#TEST-05** Implementar MSW handlers para os endpoints principais

### Fase 2 — Testes críticos (obrigatórios antes do merge)

- [ ] **#TEST-06** Testes do motor de disponibilidade (`availability.engine.test.ts`) — 100% dos casos
- [ ] **#TEST-07** Testes de isolamento multi-tenant no `AppointmentRepository`
- [ ] **#TEST-08** Testes de formato de erro RFC 7807 nos handlers de auth
- [ ] **#TEST-09** Testes do `MockNotificationProvider` — nunca chama API real em NODE_ENV=test

### Fase 3 — Cobertura de módulos

- [ ] **#TEST-10** Testes de todos os schemas Zod em `packages/shared/schemas/`
- [ ] **#TEST-11** Testes do ciclo de vida de agendamentos (transições válidas e inválidas)
- [ ] **#TEST-12** Testes do fluxo de login no frontend com MSW

---

## 10. Referências

- ADR-014: Pirâmide de Testes → `docs/adr/0014-testing-strategy.md`
- ADR-011: Zod Compartilhado → `docs/adr/0011-shared-zod-schemas.md`
- [Vitest Docs](https://vitest.dev)
- [Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [MSW — Mock Service Worker](https://mswjs.io)
