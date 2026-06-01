# SDD — Arquitetura do Backend

## BookMe · Spec Driven Development

**Documento:** `docs/specs/02-backend-architecture.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `01-database-modeling.md` concluído  
**ADRs relacionados:** ADR-002 (Monólito Modular), ADR-004 (BullMQ), ADR-007 (Redis Dual), ADR-008 (Contrato REST)

---

## 1. Objetivo

Este documento especifica a estrutura completa do backend Node.js do BookMe: organização de pastas, configuração do servidor Fastify, sistema de plugins, tratamento de erros, validação de ambiente e infraestrutura Docker. Ele é a **fundação sobre a qual todos os módulos posteriores (auth, agendamentos, notificações) são construídos**.

Ao final da leitura deste documento, você deve ser capaz de:

- Entender a estrutura de pastas do monorepo e sua lógica
- Inicializar o servidor Fastify com todos os plugins configurados
- Compreender o ciclo de vida de uma requisição (entrada → validação → handler → resposta)
- Subir o ambiente de desenvolvimento completo com Docker Compose
- Entender como os erros são capturados e formatados (ADR-008)

---

## 2. Visão Geral da Arquitetura

O backend é um **monólito modular** (ADR-002): um único processo Node.js com módulos de domínio internamente separados. Não há microserviços. A separação é por responsabilidade de código, não por processo de sistema.

```
Requisição HTTP
      │
      ▼
┌───────────────────────────────────────────┐
│              Fastify Server               │
│                                           │
│  Plugins globais:                         │
│  ├── cors          (origens permitidas)   │
│  ├── helmet        (headers de segur.)    │
│  ├── rate-limit    (proteção DDoS)        │
│  ├── jwt           (@fastify/jwt)         │
│  └── swagger       (docs automáticas)     │
│                                           │
│  Roteamento:                              │
│  └── /api/v1/                             │
│       ├── /auth        (módulo auth)      │
│       ├── /tenants     (módulo tenant)    │
│       ├── /services    (módulo serviços)  │
│       ├── /availability(módulo disp.)     │
│       └── /appointments(módulo agendam.)  │
│                                           │
│  errorHandler global → RFC 7807           │
└───────────────────────────────────────────┘
      │
      ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │ Redis Cache  │  │  Redis Queue │
│   (Drizzle)  │  │ (slots/disp) │  │   (BullMQ)   │
└──────────────┘  └──────────────┘  └──────────────┘
```

---

## 3. Estrutura de Pastas

O projeto usa estrutura de monorepo simplificado — sem Turborepo ou Nx. Dois apps (api e web) compartilham schemas via pasta `packages/shared`.

```
bookme/
├── apps/
│   ├── api/                          ← Backend Fastify (este spec)
│   │   ├── src/
│   │   │   ├── app.ts                ← Factory do servidor Fastify
│   │   │   ├── server.ts             ← Entry point (listen)
│   │   │   │
│   │   │   ├── config/
│   │   │   │   └── env.ts            ← Validação de variáveis com Zod
│   │   │   │
│   │   │   ├── infra/
│   │   │   │   ├── database/         ← (spec 01) schema, client, seed
│   │   │   │   ├── redis/
│   │   │   │   │   ├── cache.client.ts    ← Redis Cache (porta 6379)
│   │   │   │   │   └── queue.client.ts   ← Redis Queue (porta 6380)
│   │   │   │   └── http/
│   │   │   │       ├── plugins/      ← Plugins Fastify reutilizáveis
│   │   │   │       ├── middlewares/  ← authenticate, tenant-context
│   │   │   │       └── error-handler.ts
│   │   │   │
│   │   │   ├── modules/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── auth.routes.ts
│   │   │   │   │   ├── auth.service.ts
│   │   │   │   │   ├── auth.repository.ts
│   │   │   │   │   └── auth.schemas.ts   ← importa de packages/shared
│   │   │   │   ├── tenants/
│   │   │   │   ├── services/
│   │   │   │   ├── availability/
│   │   │   │   ├── appointments/
│   │   │   │   └── notifications/
│   │   │   │
│   │   │   └── shared/
│   │   │       ├── repositories/
│   │   │       │   └── base.repository.ts ← injeção de tenantId
│   │   │       ├── errors/
│   │   │       │   └── app-errors.ts      ← erros de domínio tipados
│   │   │       └── utils/
│   │   │           └── pagination.ts
│   │   │
│   │   ├── drizzle.config.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── web/                          ← Frontend React (specs 08-10)
│
├── packages/
│   └── shared/
│       └── schemas/                  ← Zod schemas compartilhados (ADR-011)
│           ├── appointment.schema.ts
│           ├── auth.schema.ts
│           ├── service.schema.ts
│           └── index.ts
│
├── docker-compose.yml
├── docker-compose.test.yml
└── package.json                      ← workspaces config
```

**Regra fundamental da arquitetura modular:**
Módulos se comunicam via `service.ts` público — nunca por import direto entre repositories de módulos diferentes. Um módulo de agendamentos pode chamar `AvailabilityService.getSlots()`, mas jamais importar `availabilityRepository` diretamente.

---

## 4. Variáveis de Ambiente

Toda configuração de ambiente é validada com Zod no boot. Se uma variável obrigatória estiver ausente, o processo encerra com erro claro — sem comportamento indefinido em produção.

```typescript
// apps/api/src/config/env.ts
import { z } from "zod";

const envSchema = z.object({
  // Servidor
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().default(3333),
  API_URL: z.string().url(),

  // Banco de dados
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),

  // Redis
  REDIS_CACHE_URL: z.string().default("redis://localhost:6379"),
  REDIS_QUEUE_URL: z.string().default("redis://localhost:6380"),

  // JWT
  JWT_SECRET: z.string().min(32, "JWT_SECRET deve ter ao menos 32 caracteres"),
  JWT_EXPIRES_IN: z.string().default("15m"),
  REFRESH_TOKEN_DAYS: z.coerce.number().default(7),

  // Notificações — Resend
  RESEND_API_KEY: z.string().optional(),

  // Frontend
  WEB_URL: z.string().url(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("❌ Variáveis de ambiente inválidas:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
```

---

## 5. Servidor Fastify

### 5.1 · Factory do servidor (`app.ts`)

O servidor é criado como uma função factory (não como singleton global). Isso permite criar instâncias isoladas em testes.

```typescript
// apps/api/src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import jwt from "@fastify/jwt";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

import { env } from "./config/env";
import { errorHandler } from "./infra/http/error-handler";

// Rotas dos módulos
import { authRoutes } from "./modules/auth/auth.routes";
import { tenantRoutes } from "./modules/tenants/tenants.routes";
import { serviceRoutes } from "./modules/services/services.routes";
import { availabilityRoutes } from "./modules/availability/availability.routes";
import { appointmentRoutes } from "./modules/appointments/appointments.routes";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "test" ? "silent" : "info",
      transport:
        env.NODE_ENV === "development"
          ? { target: "pino-pretty", options: { colorize: true } }
          : undefined,
    },
  });

  // ── Plugins de segurança ────────────────────────────────────
  await app.register(helmet);

  await app.register(cors, {
    origin: env.WEB_URL,
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // ── Autenticação ────────────────────────────────────────────
  await app.register(jwt, {
    secret: env.JWT_SECRET,
  });

  // ── Documentação ────────────────────────────────────────────
  if (env.NODE_ENV !== "production") {
    await app.register(swagger, {
      openapi: {
        info: { title: "BookMe API", version: "1.0.0" },
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
          },
        },
      },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });
  }

  // ── Rotas ───────────────────────────────────────────────────
  await app.register(authRoutes, { prefix: "/api/v1/auth" });
  await app.register(tenantRoutes, { prefix: "/api/v1/tenants" });
  await app.register(serviceRoutes, { prefix: "/api/v1/services" });
  await app.register(availabilityRoutes, { prefix: "/api/v1/availability" });
  await app.register(appointmentRoutes, { prefix: "/api/v1/appointments" });

  // ── Tratamento global de erros ──────────────────────────────
  app.setErrorHandler(errorHandler);

  return app;
}
```

### 5.2 · Entry point (`server.ts`)

```typescript
// apps/api/src/server.ts
import { buildApp } from "./app";
import { env } from "./config/env";

async function main() {
  const app = await buildApp();

  try {
    await app.listen({ port: env.PORT, host: "0.0.0.0" });
    console.log(`🚀 BookMe API rodando em http://localhost:${env.PORT}`);
    console.log(`📚 Documentação em http://localhost:${env.PORT}/docs`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
```

---

## 6. Tratamento de Erros (ADR-008)

### 6.1 · Erros de domínio tipados

```typescript
// apps/api/src/shared/errors/app-errors.ts

export class AppError extends Error {
  constructor(
    public readonly type: string,
    public readonly title: string,
    public readonly status: number,
    public readonly detail: string,
    public readonly errors?: Array<{ field: string; message: string }>,
  ) {
    super(detail);
    this.name = "AppError";
  }
}

// Erros específicos do domínio
export class UnauthorizedError extends AppError {
  constructor(detail = "Autenticação necessária.") {
    super(
      "https://bookme.com.br/errors/unauthorized",
      "Não autorizado",
      401,
      detail,
    );
  }
}

export class ForbiddenError extends AppError {
  constructor(detail = "Acesso não permitido.") {
    super(
      "https://bookme.com.br/errors/forbidden",
      "Acesso negado",
      403,
      detail,
    );
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(
      "https://bookme.com.br/errors/not-found",
      "Recurso não encontrado",
      404,
      `${resource} não encontrado.`,
    );
  }
}

export class ConflictError extends AppError {
  constructor(detail: string) {
    super("https://bookme.com.br/errors/conflict", "Conflito", 409, detail);
  }
}

export class ValidationError extends AppError {
  constructor(errors: Array<{ field: string; message: string }>) {
    super(
      "https://bookme.com.br/errors/validation",
      "Dados inválidos",
      422,
      "Um ou mais campos não passaram na validação.",
      errors,
    );
  }
}

export class SlotUnavailableError extends AppError {
  constructor() {
    super(
      "https://bookme.com.br/errors/slot-unavailable",
      "Horário indisponível",
      409,
      "O horário solicitado não está mais disponível.",
    );
  }
}
```

### 6.2 · Error handler global (RFC 7807)

```typescript
// apps/api/src/infra/http/error-handler.ts
import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../../shared/errors/app-errors";
import { ZodError } from "zod";

export function errorHandler(
  error: FastifyError | AppError | ZodError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  // Obtém o traceId do OpenTelemetry (spec 07)
  const traceId = request.headers["x-trace-id"] as string | undefined;

  // Erros de domínio conhecidos
  if (error instanceof AppError) {
    return reply.status(error.status).send({
      type: error.type,
      title: error.title,
      status: error.status,
      detail: error.detail,
      instance: request.url,
      traceId,
      ...(error.errors && { errors: error.errors }),
    });
  }

  // Erros de validação do Fastify (schema JSON)
  if (error.validation) {
    return reply.status(422).send({
      type: "https://bookme.com.br/errors/validation",
      title: "Dados inválidos",
      status: 422,
      detail: "Um ou mais campos não passaram na validação.",
      instance: request.url,
      traceId,
      errors: error.validation.map((v) => ({
        field: v.instancePath.replace("/", ""),
        message: v.message ?? "Campo inválido",
      })),
    });
  }

  // Erros Zod (caso cheguem até aqui)
  if (error instanceof ZodError) {
    return reply.status(422).send({
      type: "https://bookme.com.br/errors/validation",
      title: "Dados inválidos",
      status: 422,
      detail: "Um ou mais campos não passaram na validação.",
      instance: request.url,
      traceId,
      errors: error.errors.map((e) => ({
        field: e.path.join("."),
        message: e.message,
      })),
    });
  }

  // Erros inesperados — não expor detalhes internos em produção
  request.log.error({ err: error, traceId }, "Unhandled error");

  return reply.status(500).send({
    type: "https://bookme.com.br/errors/internal",
    title: "Erro interno",
    status: 500,
    detail: "Ocorreu um erro inesperado. Nossa equipe foi notificada.",
    instance: request.url,
    traceId,
  });
}
```

---

## 7. Middleware de Autenticação

```typescript
// apps/api/src/infra/http/middlewares/authenticate.ts
import type { FastifyRequest, FastifyReply } from "fastify";
import { UnauthorizedError } from "../../../shared/errors/app-errors";

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  try {
    await request.jwtVerify();
  } catch {
    throw new UnauthorizedError("Token inválido ou expirado.");
  }
}
```

**Uso nas rotas protegidas:**

```typescript
app.get("/profile", { preHandler: [authenticate] }, async (request, reply) => {
  // request.user contém o payload do JWT: { tenantId, email }
});
```

---

## 8. Clientes Redis

```typescript
// apps/api/src/infra/redis/cache.client.ts
import { createClient } from "redis";
import { env } from "../../config/env";

export const redisCache = createClient({ url: env.REDIS_CACHE_URL });

redisCache.on("error", (err) => console.error("Redis Cache error:", err));

export async function connectRedisCache() {
  await redisCache.connect();
  console.log("✅ Redis Cache conectado");
}
```

```typescript
// apps/api/src/infra/redis/queue.client.ts
import IORedis from "ioredis";
import { env } from "../../config/env";

// BullMQ requer ioredis, não o cliente oficial
export const redisQueue = new IORedis(env.REDIS_QUEUE_URL, {
  maxRetriesPerRequest: null, // obrigatório para BullMQ
});

redisQueue.on("error", (err) => console.error("Redis Queue error:", err));
```

---

## 9. BaseRepository

O `BaseRepository` garante que todas as queries de domínio são filtradas pelo `tenant_id` do usuário autenticado — a primeira camada de proteção multi-tenant.

```typescript
// apps/api/src/shared/repositories/base.repository.ts
import type { DrizzleClient } from "../../infra/database/client";

export class BaseRepository {
  constructor(
    protected readonly db: DrizzleClient,
    protected readonly tenantId: string,
  ) {}
}

// Uso em um repository de domínio:
export class AppointmentRepository extends BaseRepository {
  async findAll() {
    return this.db.query.appointments.findMany({
      where: (apt, { eq }) => eq(apt.tenantId, this.tenantId),
      orderBy: (apt, { desc }) => [desc(apt.scheduledAt)],
    });
  }
}
```

---

## 10. Docker Compose

```yaml
# docker-compose.yml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bookme
      POSTGRES_PASSWORD: bookme
      POSTGRES_DB: bookme_dev
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bookme"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis-cache:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"

  redis-queue:
    image: redis:7-alpine
    command: redis-server --maxmemory-policy noeviction --appendonly yes
    ports:
      - "6380:6380"
    volumes:
      - redis_queue_data:/data

volumes:
  postgres_data:
  redis_queue_data:
```

```yaml
# docker-compose.test.yml — banco isolado para testes de integração
version: "3.9"

services:
  postgres-test:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: bookme_test
      POSTGRES_PASSWORD: bookme_test
      POSTGRES_DB: bookme_test
    ports:
      - "5433:5432"

  redis-test:
    image: redis:7-alpine
    command: redis-server --maxmemory-policy noeviction
    ports:
      - "6381:6379"
```

---

## 11. Scripts de Desenvolvimento

```json
// apps/api/package.json
{
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "build": "tsc -p tsconfig.build.json",
    "start": "node dist/server.js",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "fastify": "^5.x",
    "@fastify/cors": "^10.x",
    "@fastify/helmet": "^12.x",
    "@fastify/jwt": "^9.x",
    "@fastify/rate-limit": "^10.x",
    "@fastify/swagger": "^9.x",
    "@fastify/swagger-ui": "^5.x",
    "drizzle-orm": "^0.36.x",
    "bullmq": "^5.x",
    "ioredis": "^5.x",
    "redis": "^4.x",
    "zod": "^3.x",
    "bcryptjs": "^2.x",
    "pino-pretty": "^13.x"
  },
  "devDependencies": {
    "tsx": "^4.x",
    "typescript": "^5.x",
    "drizzle-kit": "^0.28.x",
    "@types/node": "^22.x",
    "vitest": "^2.x"
  }
}
```

---

## 12. Checklist de Implementação

### Fase 1 — Estrutura e configuração

- [ ] **#BE-01** Criar estrutura de pastas do monorepo (`apps/api`, `apps/web`, `packages/shared`)
- [ ] **#BE-02** Configurar `package.json` raiz com workspaces
- [ ] **#BE-03** Configurar `tsconfig.json` e `tsconfig.build.json` na API
- [ ] **#BE-04** Implementar `config/env.ts` com validação Zod e testar falha intencional de variável

### Fase 2 — Servidor

- [ ] **#BE-05** Instalar dependências Fastify e plugins
- [ ] **#BE-06** Implementar `app.ts` (factory) e `server.ts` (entry point)
- [ ] **#BE-07** Verificar que `GET /docs` responde o Swagger em development
- [ ] **#BE-08** Implementar `error-handler.ts` e testar com rota proposital de erro

### Fase 3 — Infraestrutura

- [ ] **#BE-09** Configurar `docker-compose.yml` com postgres, redis-cache e redis-queue
- [ ] **#BE-10** Implementar e testar `cache.client.ts` e `queue.client.ts`
- [ ] **#BE-11** Implementar `BaseRepository` com injeção de `tenantId`
- [ ] **#BE-12** Criar `shared/errors/app-errors.ts` com todos os erros de domínio

### Fase 4 — Validação

- [ ] **#BE-13** Escrever teste de integração que verifica o formato RFC 7807 dos erros
- [ ] **#BE-14** Verificar que uma requisição sem JWT retorna 401 no formato correto
- [ ] **#BE-15** Configurar `docker-compose.test.yml` e variável `DATABASE_URL` de teste

---

## 13. Referências

- ADR-002: Monólito Modular → `docs/adr/0002-monolito-modular.md`
- ADR-007: Redis Dual-Instance → `docs/adr/0007-redis-dual-instance.md`
- ADR-008: Contrato REST + Formato de Erros → `docs/adr/0008-api-error-format.md`
- [Fastify Docs](https://fastify.dev/docs/latest/)
- [Fastify + TypeScript](https://fastify.dev/docs/latest/Reference/TypeScript/)
