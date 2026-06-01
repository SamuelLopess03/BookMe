# SDD — Deploy e CI/CD

## BookMe · Spec Driven Development

**Documento:** `docs/specs/12-deploy-cicd.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `11-testing-strategy.md` concluído  
**ADRs relacionados:** ADR-002 (Monólito Modular), ADR-007 (Redis Dual)

---

## 1. Objetivo

Este documento especifica a estratégia de deploy, infraestrutura de produção e pipeline de CI/CD do BookMe. O objetivo é um processo de deploy confiável, automatizado e reversível — onde qualquer desenvolvedor pode colocar uma nova versão em produção com um único `git push`.

Ao final deste documento, você deve ser capaz de:

- Entender a infraestrutura de produção e os serviços utilizados
- Configurar o pipeline de CI/CD com GitHub Actions
- Fazer o primeiro deploy do sistema
- Entender a estratégia de migrations em produção
- Reverter um deploy problemático com segurança

---

## 2. Infraestrutura de Produção

O BookMe usa serviços gerenciados para reduzir a carga operacional na fase inicial. A escolha prioriza custo-benefício e simplicidade de operação.

```
┌─────────────────────────────────────────────────────┐
│                     Internet                         │
└────────────────────┬────────────────────────────────┘
                     │
             ┌───────▼───────┐
             │  Cloudflare   │  ← DNS + CDN + DDoS protection
             └───────┬───────┘
                     │
        ┌────────────┴────────────┐
        │                         │
┌───────▼───────┐        ┌────────▼──────┐
│  Vercel       │        │  Railway      │
│  (Frontend)   │        │  (Backend)    │
│               │        │               │
│  apps/web     │        │  apps/api     │
│  React SPA    │        │  Fastify      │
└───────────────┘        └────────┬──────┘
                                  │
                    ┌─────────────┼──────────────┐
                    │             │              │
             ┌──────▼───────┐ ┌───▼────┐  ┌──────▼─────┐
             │  PostgreSQL  │ │ Redis  │  │ Redis Queue│
             │  (Railway)   │ │ Cache  │  │  (Railway) │
             └──────────────┘ └────────┘  └────────────┘
```

**Por que Railway para o backend?**
Railway gerencia o servidor Node.js, PostgreSQL e as duas instâncias Redis em um único painel, com suporte a variáveis de ambiente por ambiente, deploy automático via Git, e rollback com um clique. O custo inicial é baixo (~$10–20/mês).

**Por que Vercel para o frontend?**
Deploy automático a cada push, CDN global, preview deployments por branch (permite testar uma feature antes de mergear), e plano gratuito generoso para SPAs.

---

## 3. Variáveis de Ambiente por Ambiente

```
AMBIENTE         | DATABASE_URL | REDIS_CACHE | REDIS_QUEUE | JWT_SECRET | RESEND_KEY
─────────────────┼──────────────┼─────────────┼─────────────┼────────────┼───────────
development      | localhost    | localhost   | localhost   | dev-secret | (vazio — Mock)
test (CI)        | postgres-ci  | redis-ci    | redis-ci    | test-secret| (vazio — Mock)
staging          | Railway staging | Railway  | Railway     | gerado     | staging key
production       | Railway prod | Railway    | Railway     | gerado     | prod key
```

**Regra de ouro:** o `NODE_ENV=production` ativa automaticamente:

- Mock desabilitado (providers reais de e-mail)
- Swagger desabilitado (não expõe documentação publicamente)
- Logs em JSON (sem pino-pretty)
- Cookies `Secure: true`

---

## 4. Pipeline CI/CD com GitHub Actions

O pipeline tem dois workflows:

**`ci.yml`** — roda em todo pull request. Bloqueia o merge se falhar.

**`deploy.yml`** — roda apenas no merge para `main`. Faz o deploy automático.

### 4.1 · CI (Pull Request)

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
    branches: [main, develop]

jobs:
  # ── Verificação de tipos ───────────────────────────────────────
  typecheck:
    name: TypeScript
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck

  # ── Lint ───────────────────────────────────────────────────────
  lint:
    name: Lint
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint

  # ── Testes ────────────────────────────────────────────────────
  test:
    name: Tests
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: bookme_test
          POSTGRES_PASSWORD: bookme_test
          POSTGRES_DB: bookme_test
        ports: ["5433:5432"]
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:7-alpine
        ports: ["6381:6379"]
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://bookme_test:bookme_test@localhost:5433/bookme_test
      REDIS_CACHE_URL: redis://localhost:6381
      REDIS_QUEUE_URL: redis://localhost:6381
      JWT_SECRET: test-secret-com-pelo-menos-32-caracteres
      API_URL: http://localhost:3333
      WEB_URL: http://localhost:5173

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile

      # Aplica migrations no banco de teste
      - name: Run database migrations
        run: pnpm --filter=api db:migrate

      # Executa todos os testes com cobertura
      - name: Run tests
        run: pnpm test:coverage

      # Publica o relatório de cobertura como comentário no PR
      - name: Coverage report
        uses: davelosert/vitest-coverage-report-action@v2
        if: always()
```

### 4.2 · Deploy (Merge para main)

```yaml
# .github/workflows/deploy.yml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-api:
    name: Deploy API → Railway
    runs-on: ubuntu-latest
    environment: production

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile

      # Builda o projeto antes de enviar
      - name: Build API
        run: pnpm --filter=api build

      # Instala Railway CLI e faz deploy
      - name: Deploy to Railway
        uses: railwayapp/railway-github-action@v1
        with:
          railway-token: ${{ secrets.RAILWAY_TOKEN }}
          service: bookme-api

      # Após o deploy, executa migrations pendentes
      # Usa o Railway CLI para executar no ambiente de produção
      - name: Run production migrations
        run: |
          npx railway run --service bookme-api pnpm db:migrate
        env:
          RAILWAY_TOKEN: ${{ secrets.RAILWAY_TOKEN }}

  deploy-web:
    name: Deploy Web → Vercel
    runs-on: ubuntu-latest
    environment: production

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: "22", cache: "pnpm" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter=web build

      - name: Deploy to Vercel
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          working-directory: apps/web
          vercel-args: "--prod"
```

---

## 5. Estratégia de Migrations em Produção

Migrations em produção são a operação de maior risco no ciclo de deploy. As regras abaixo evitam downtime e perda de dados.

### 5.1 · Regras obrigatórias

**Regra 1 — Apenas additive migrations são seguras:**
Adicionar colunas e tabelas é seguro. Remover ou renomear em produção exige uma estratégia de 3 passos.

**Regra 2 — Novas colunas obrigatórias precisam de DEFAULT ou nullable:**

```sql
-- ✅ Correto — não quebra linhas existentes
ALTER TABLE appointments ADD COLUMN notes text;

-- ❌ Perigoso — quebra INSERT sem o campo em código antigo ainda rodando
ALTER TABLE appointments ADD COLUMN notes text NOT NULL;
```

**Regra 3 — Para renomear uma coluna, use 3 deploys:**

```
Deploy 1: adiciona nova coluna, código lê as duas
Deploy 2: código escreve apenas na nova coluna
Deploy 3: remove coluna antiga
```

**Regra 4 — Migrations são executadas DEPOIS do build, ANTES do novo processo subir:**
O Railway executa o `startCommand` do `railway.json` que inclui `db:migrate` antes do `server.js`.

```json
// apps/api/railway.json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "nixpacks",
    "buildCommand": "pnpm install --frozen-lockfile && pnpm --filter=api build"
  },
  "deploy": {
    "startCommand": "node -e 'require(\"./dist/infra/database/migrate\")' && node dist/server.js",
    "healthcheckPath": "/health",
    "healthcheckTimeout": 30,
    "restartPolicyType": "on-failure",
    "restartPolicyMaxRetries": 3
  }
}
```

```typescript
// apps/api/src/infra/database/migrate.ts
// Arquivo separado executado antes do server — pode ser await top-level
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "./client";
import path from "path";

async function runMigrations() {
  console.log("🔄 Executando migrations...");
  await migrate(db, {
    migrationsFolder: path.join(__dirname, "../../../migrations"),
  });
  console.log("✅ Migrations concluídas");
  process.exit(0); // Processo termina — Railway inicia o server a seguir
}

runMigrations().catch((err) => {
  console.error("❌ Falha nas migrations:", err);
  process.exit(1); // Falha nas migrations → deploy aborta automaticamente
});
```

---

## 6. Health Check

O Railway usa o endpoint `/health` para verificar se o processo está saudável antes de redirecionar tráfego.

```typescript
// Adicionar no app.ts (antes das rotas de domínio)
app.get("/health", async (request, reply) => {
  try {
    // Verifica conexão com o banco
    await db.execute(sql`SELECT 1`);

    // Verifica conexão com o Redis Cache
    await redisCache.ping();

    return reply.send({
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version,
    });
  } catch (error) {
    return reply.status(503).send({
      status: "unhealthy",
      error: error instanceof Error ? error.message : "Unknown error",
    });
  }
});
```

---

## 7. Preview Deployments (Vercel)

O Vercel cria automaticamente uma URL de preview para cada branch ou PR, apontando para a API de staging:

```bash
# apps/web/.env.production
VITE_API_URL=https://bookme-api.railway.app

# apps/web/.env.staging  (usado nos preview deployments)
VITE_API_URL=https://bookme-api-staging.railway.app
```

Configuração no `vercel.json`:

```json
{
  "env": {
    "VITE_API_URL": "https://bookme-api.railway.app"
  },
  "build": {
    "env": {
      "VITE_API_URL": "https://bookme-api.railway.app"
    }
  }
}
```

---

## 8. Rollback

**Frontend (Vercel):** Interface web → Deployments → selecionar deploy anterior → "Promote to Production". Leva ~10 segundos.

**Backend (Railway):** Interface web → Deployments → selecionar deploy anterior → "Rollback". O processo anterior é reiniciado com o código anterior.

**Rollback de migration:** Drizzle não suporta rollback automático de migrations. A estratégia correta é um migration "de correção" que desfaz a mudança. Por isso as regras da seção 5.1 são críticas — evitar modificações destrutivas elimina a necessidade de rollback de banco.

---

## 9. Segredos e Variáveis no GitHub

Configure os seguintes secrets no GitHub → Settings → Secrets and variables → Actions:

| Secret              | Descrição                                         |
| ------------------- | ------------------------------------------------- |
| `RAILWAY_TOKEN`     | Token de serviço do Railway (não o token pessoal) |
| `VERCEL_TOKEN`      | Token da conta Vercel                             |
| `VERCEL_ORG_ID`     | ID da organização Vercel                          |
| `VERCEL_PROJECT_ID` | ID do projeto web no Vercel                       |

---

## 10. Checklist de Implementação

### Fase 1 — Setup inicial

- [ ] **#DEPLOY-01** Criar projeto no Railway com os 4 serviços: API, PostgreSQL, Redis Cache, Redis Queue
- [ ] **#DEPLOY-02** Criar projeto no Vercel apontando para `apps/web`
- [ ] **#DEPLOY-03** Configurar variáveis de ambiente de produção no Railway
- [ ] **#DEPLOY-04** Configurar variáveis de ambiente no Vercel (`VITE_API_URL`)

### Fase 2 — Primeiro deploy manual

- [ ] **#DEPLOY-05** Fazer build local (`pnpm build`) e garantir que não há erros de TypeScript
- [ ] **#DEPLOY-06** Executar migrations em produção manualmente via Railway CLI
- [ ] **#DEPLOY-07** Verificar endpoint `/health` retorna `{"status":"healthy"}`
- [ ] **#DEPLOY-08** Verificar que o frontend conecta na API de produção

### Fase 3 — CI/CD

- [ ] **#DEPLOY-09** Criar `ci.yml` e verificar que roda em pull requests
- [ ] **#DEPLOY-10** Criar `deploy.yml` e verificar deploy automático no merge para `main`
- [ ] **#DEPLOY-11** Configurar todos os secrets no GitHub
- [ ] **#DEPLOY-12** Fazer um PR de teste: verificar que CI passa e PR não pode ser mergeado com CI falhando
- [ ] **#DEPLOY-13** Mergear o PR de teste e verificar deploy automático nos logs do Actions

### Fase 4 — Validação

- [ ] **#DEPLOY-14** Testar rollback manual pelo painel do Railway
- [ ] **#DEPLOY-15** Verificar que logs do Fastify aparecem no Railway Logs em formato JSON
- [ ] **#DEPLOY-16** Configurar alertas no Railway para reinicialização automática (já no `railway.json`)

---

## 11. Referências

- ADR-002: Monólito Modular → deploy único facilita o processo
- ADR-007: Redis Dual-Instance → dois serviços Redis no Railway
- [Railway Docs](https://docs.railway.app)
- [Vercel Docs — Monorepos](https://vercel.com/docs/monorepos)
- [GitHub Actions — Secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Drizzle Kit — Migrations](https://orm.drizzle.team/kit-docs/overview)
