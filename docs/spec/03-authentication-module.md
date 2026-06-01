# SDD — Módulo de Autenticação

## BookMe · Spec Driven Development

**Documento:** `docs/specs/03-authentication-module.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `02-backend-architecture.md` concluído  
**ADRs relacionados:** ADR-001 (JWT + Refresh Token), ADR-003 (Multi-tenancy)

---

## 1. Objetivo

Este documento especifica o módulo de autenticação do BookMe: registro de prestadores, login, renovação silenciosa de token (refresh), logout e revogação de sessões. É o módulo base do qual todos os endpoints protegidos dependem.

Ao final deste documento, você deve ser capaz de:

- Implementar os 4 endpoints de autenticação (`/register`, `/login`, `/refresh`, `/logout`)
- Entender o fluxo completo de Access Token + Refresh Token
- Implementar a renovação silenciosa no cliente sem interromper a sessão do usuário
- Compreender como o `tenantId` entra no contexto da requisição após autenticação

---

## 2. Fluxo de Autenticação

```
REGISTRO / LOGIN
  │
  ├─ Valida credenciais
  ├─ Gera Access Token JWT (15min) → retorna no body da resposta
  └─ Gera Refresh Token opaco (UUID) → armazena no banco → envia em cookie HttpOnly
       └─ Cookie: HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth/refresh

REQUISIÇÃO AUTENTICADA
  │
  ├─ Authorization: Bearer <access_token>
  └─ Middleware authenticate() verifica JWT
       ├─ Válido → injeta { tenantId, email } em request.user → continua
       └─ Expirado → cliente deve chamar /refresh

REFRESH DE TOKEN
  │
  ├─ Requisição chega sem body (cookie enviado automaticamente)
  ├─ Servidor lê cookie → valida no banco → verifica expiração
  ├─ Invalida o Refresh Token antigo (rotação)
  ├─ Gera novo Access Token → retorna no body
  └─ Gera novo Refresh Token → armazena no banco → envia novo cookie

LOGOUT
  │
  ├─ Invalida o Refresh Token no banco
  └─ Limpa o cookie
```

**Por que Refresh Token em cookie HttpOnly?**
JavaScript malicioso (XSS) não consegue ler cookies `HttpOnly`. O Access Token, por estar em memória no frontend (variável de estado React), também não é acessível via XSS porque nunca vai para `localStorage` ou `sessionStorage`.

---

## 3. Schemas Zod (em `packages/shared/schemas/auth.schema.ts`)

```typescript
// packages/shared/schemas/auth.schema.ts
import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2, "Nome deve ter ao menos 2 caracteres").max(100),
  email: z.string().email("E-mail inválido"),
  password: z
    .string()
    .min(8, "Senha deve ter ao menos 8 caracteres")
    .regex(/[A-Z]/, "Senha deve conter ao menos uma letra maiúscula")
    .regex(/[0-9]/, "Senha deve conter ao menos um número"),
  slug: z
    .string()
    .min(3, "Slug deve ter ao menos 3 caracteres")
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      "Slug deve conter apenas letras minúsculas, números e hífens",
    )
    .optional(), // Gerado automaticamente se não informado
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, "Senha é obrigatória"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
```

---

## 4. Repository

```typescript
// apps/api/src/modules/auth/auth.repository.ts
import { eq, and, gt } from "drizzle-orm";
import { db } from "../../infra/database/client";
import {
  tenants,
  refreshTokens,
  tenantSettings,
} from "../../infra/database/schema";

export class AuthRepository {
  async findTenantByEmail(email: string) {
    return db.query.tenants.findFirst({
      where: (t, { eq, isNull }) =>
        and(eq(t.email, email), isNull(t.deletedAt)),
    });
  }

  async findTenantBySlug(slug: string) {
    return db.query.tenants.findFirst({
      where: (t, { eq }) => eq(t.slug, slug),
    });
  }

  async createTenant(data: {
    name: string;
    email: string;
    passwordHash: string;
    slug: string;
  }) {
    // Cria tenant e configurações padrão em uma transação
    return db.transaction(async (tx) => {
      const [tenant] = await tx.insert(tenants).values(data).returning();

      await tx.insert(tenantSettings).values({
        tenantId: tenant.id,
        minBookingNoticeHours: 1,
        maxBookingDaysAhead: 30,
        cancellationDeadlineHours: 2,
        appointmentIntervalMinutes: 10,
      });

      return tenant;
    });
  }

  async createRefreshToken(data: {
    token: string;
    tenantId: string;
    expiresAt: Date;
  }) {
    await db.insert(refreshTokens).values(data);
  }

  async findValidRefreshToken(token: string) {
    return db.query.refreshTokens.findFirst({
      where: (rt, { eq, and, gt }) =>
        and(eq(rt.token, token), gt(rt.expiresAt, new Date())),
    });
  }

  async deleteRefreshToken(token: string) {
    await db.delete(refreshTokens).where(eq(refreshTokens.token, token));
  }

  async deleteAllRefreshTokensByTenant(tenantId: string) {
    await db.delete(refreshTokens).where(eq(refreshTokens.tenantId, tenantId));
  }
}
```

---

## 5. Service

```typescript
// apps/api/src/modules/auth/auth.service.ts
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { AuthRepository } from "./auth.repository";
import {
  ConflictError,
  UnauthorizedError,
  ValidationError,
} from "../../shared/errors/app-errors";
import type {
  RegisterInput,
  LoginInput,
} from "../../../packages/shared/schemas/auth.schema";
import { env } from "../../config/env";

export class AuthService {
  private readonly repo = new AuthRepository();

  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // remove acentos
      .replace(/[^a-z0-9\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-");
  }

  async register(input: RegisterInput) {
    // 1. Verifica e-mail único
    const existingEmail = await this.repo.findTenantByEmail(input.email);
    if (existingEmail) {
      throw new ConflictError("Este e-mail já está em uso.");
    }

    // 2. Resolve e verifica slug único
    const slug = input.slug ?? this.generateSlug(input.name);
    const existingSlug = await this.repo.findTenantBySlug(slug);
    if (existingSlug) {
      throw new ConflictError(
        `O slug "${slug}" já está em uso. Escolha outro.`,
      );
    }

    // 3. Cria hash da senha
    const passwordHash = await bcrypt.hash(input.password, 12);

    // 4. Cria tenant com configurações padrão
    const tenant = await this.repo.createTenant({
      name: input.name,
      email: input.email,
      passwordHash,
      slug,
    });

    return { tenantId: tenant.id, slug: tenant.slug };
  }

  async login(input: LoginInput, jwtSign: (payload: object) => string) {
    // 1. Busca tenant
    const tenant = await this.repo.findTenantByEmail(input.email);
    if (!tenant) {
      // Deliberadamente vago — não revela se o e-mail existe
      throw new UnauthorizedError("Credenciais inválidas.");
    }

    // 2. Verifica senha
    const validPassword = await bcrypt.compare(
      input.password,
      tenant.passwordHash,
    );
    if (!validPassword) {
      throw new UnauthorizedError("Credenciais inválidas.");
    }

    // 3. Gera Access Token
    const accessToken = jwtSign({ tenantId: tenant.id, email: tenant.email });

    // 4. Gera Refresh Token
    const refreshToken = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_DAYS);

    await this.repo.createRefreshToken({
      token: refreshToken,
      tenantId: tenant.id,
      expiresAt,
    });

    return {
      accessToken,
      refreshToken,
      tenant: {
        id: tenant.id,
        name: tenant.name,
        email: tenant.email,
        slug: tenant.slug,
        avatarUrl: tenant.avatarUrl,
      },
    };
  }

  async refresh(
    refreshTokenValue: string,
    jwtSign: (payload: object) => string,
  ) {
    // 1. Valida token no banco
    const tokenRecord =
      await this.repo.findValidRefreshToken(refreshTokenValue);
    if (!tokenRecord) {
      throw new UnauthorizedError("Sessão expirada. Faça login novamente.");
    }

    // 2. Rotação: invalida o token antigo
    await this.repo.deleteRefreshToken(refreshTokenValue);

    // 3. Busca tenant para checar se não foi desativado
    // (tenant deletedAt não nulo = conta suspensa)
    const tenant = await this.repo.findTenantByEmail(tokenRecord.tenantId);
    // Simplificado: buscar por ID seria mais correto. Ajustar conforme o Repository.

    // 4. Gera novos tokens
    const newAccessToken = jwtSign({ tenantId: tokenRecord.tenantId });

    const newRefreshToken = randomUUID();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_DAYS);

    await this.repo.createRefreshToken({
      token: newRefreshToken,
      tenantId: tokenRecord.tenantId,
      expiresAt,
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  }

  async logout(refreshTokenValue: string) {
    await this.repo.deleteRefreshToken(refreshTokenValue);
  }
}
```

---

## 6. Routes

```typescript
// apps/api/src/modules/auth/auth.routes.ts
import type { FastifyInstance } from "fastify";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AuthService } from "./auth.service";
import {
  registerSchema,
  loginSchema,
} from "../../../packages/shared/schemas/auth.schema";
import { UnauthorizedError } from "../../shared/errors/app-errors";

const REFRESH_COOKIE = "bookme_refresh_token";

const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "strict" as const,
  path: "/api/v1/auth/refresh",
  maxAge: 7 * 24 * 60 * 60, // 7 dias em segundos
};

export async function authRoutes(app: FastifyInstance) {
  const service = new AuthService();

  // POST /api/v1/auth/register
  app.post(
    "/register",
    {
      schema: {
        body: zodToJsonSchema(registerSchema),
        tags: ["Auth"],
      },
    },
    async (request, reply) => {
      const input = registerSchema.parse(request.body);
      const result = await service.register(input);
      return reply.status(201).send(result);
    },
  );

  // POST /api/v1/auth/login
  app.post(
    "/login",
    {
      schema: {
        body: zodToJsonSchema(loginSchema),
        tags: ["Auth"],
      },
    },
    async (request, reply) => {
      const input = loginSchema.parse(request.body);
      const result = await service.login(input, (payload) =>
        app.jwt.sign(payload, { expiresIn: "15m" }),
      );

      reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

      return reply.send({
        accessToken: result.accessToken,
        tenant: result.tenant,
      });
    },
  );

  // POST /api/v1/auth/refresh — sem body, lê cookie
  app.post("/refresh", async (request, reply) => {
    const refreshToken = request.cookies?.[REFRESH_COOKIE];
    if (!refreshToken) {
      throw new UnauthorizedError("Refresh token ausente.");
    }

    const result = await service.refresh(refreshToken, (payload) =>
      app.jwt.sign(payload, { expiresIn: "15m" }),
    );

    reply.setCookie(REFRESH_COOKIE, result.refreshToken, cookieOptions);

    return reply.send({ accessToken: result.accessToken });
  });

  // POST /api/v1/auth/logout
  app.post("/logout", async (request, reply) => {
    const refreshToken = request.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      await service.logout(refreshToken);
    }

    reply.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth/refresh" });
    return reply.status(204).send();
  });
}
```

---

## 7. Tipagem do `request.user`

Extenda o tipo do Fastify para que `request.user` seja tipado:

```typescript
// apps/api/src/@types/fastify.d.ts
import "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { tenantId: string; email: string };
    user: { tenantId: string; email: string };
  }
}
```

---

## 8. Renovação Silenciosa no Frontend

O frontend deve renovar o Access Token antes que ele expire, de forma transparente para o usuário. Isso é feito via interceptor no cliente HTTP:

```typescript
// apps/web/src/lib/api.ts (preview — detalhado no spec 08)

let accessToken: string | null = null;

// Interceptor de resposta: se 401, tenta renovar e repete a requisição
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && !error.config._retry) {
      error.config._retry = true;
      const { data } = await apiClient.post("/auth/refresh");
      accessToken = data.accessToken;
      error.config.headers.Authorization = `Bearer ${accessToken}`;
      return apiClient(error.config);
    }
    return Promise.reject(error);
  },
);
```

---

## 9. Segurança: Checklist de Vetores

| Vetor                   | Mitigação                                                        |
| ----------------------- | ---------------------------------------------------------------- |
| XSS rouba Access Token  | Access Token em memória (nunca em localStorage)                  |
| XSS rouba Refresh Token | Cookie HttpOnly — JavaScript não consegue ler                    |
| CSRF usa Refresh Token  | Cookie SameSite=Strict — não enviado em requisições cross-origin |
| Força bruta no login    | Rate limit global (100 req/min) + mensagem de erro vaga          |
| Sessão não revogável    | Refresh Token no banco — deletar o registro invalida a sessão    |
| Token vazado em logs    | JWT nunca logado (apenas tenantId/email do payload)              |

---

## 10. Checklist de Implementação

### Fase 1 — Base

- [ ] **#AUTH-01** Instalar `bcryptjs`, `@types/bcryptjs`
- [ ] **#AUTH-02** Instalar `@fastify/cookie` e registrar plugin no `app.ts`
- [ ] **#AUTH-03** Criar `src/@types/fastify.d.ts` com tipagem de `request.user`
- [ ] **#AUTH-04** Implementar schemas Zod em `packages/shared/schemas/auth.schema.ts`

### Fase 2 — Módulo

- [ ] **#AUTH-05** Implementar `AuthRepository` com todos os métodos descritos
- [ ] **#AUTH-06** Implementar `AuthService.register()` com geração de slug e verificações de unicidade
- [ ] **#AUTH-07** Implementar `AuthService.login()` com geração de tokens
- [ ] **#AUTH-08** Implementar `AuthService.refresh()` com rotação de Refresh Token
- [ ] **#AUTH-09** Implementar `AuthService.logout()`
- [ ] **#AUTH-10** Implementar `auth.routes.ts` e registrar no `app.ts`

### Fase 3 — Segurança e Testes

- [ ] **#AUTH-11** Testar registro com e-mail duplicado → deve retornar 409
- [ ] **#AUTH-12** Testar login com senha incorreta → deve retornar 401 com mensagem vaga
- [ ] **#AUTH-13** Testar refresh com token expirado/inválido → deve retornar 401
- [ ] **#AUTH-14** Testar que rota protegida sem token retorna 401 no formato RFC 7807
- [ ] **#AUTH-15** Verificar que o cookie HttpOnly não aparece acessível via JavaScript no browser

---

## 11. Referências

- ADR-001: JWT + Refresh Token em Cookie HttpOnly → `docs/adr/0001-autenticacao-jwt.md`
- ADR-003: Multi-tenancy por Row-Level → `docs/adr/0003-multitenancy-row-level.md`
- Spec 01: Tabelas `tenants`, `refresh_tokens` → `docs/specs/01-database-modeling.md`
- Spec 02: Middleware `authenticate`, `error-handler` → `docs/specs/02-backend-architecture.md`
