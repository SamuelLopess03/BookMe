<div align="center">

# BookMe

**Plataforma SaaS de agendamentos online para prestadores de serviço autônomos**

[![CI](https://github.com/SamuelLopess03/BookMe/actions/workflows/ci.yml/badge.svg)](https://github.com/SamuelLopess03/BookMe/actions/workflows/ci.yml)
[![CD](https://github.com/SamuelLopess03/BookMe/actions/workflows/cd.yml/badge.svg)](https://github.com/SamuelLopess03/BookMe/actions/workflows/cd.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

[Documentação](../../wiki) · [Relatório de Bug](../../issues/new?template=bug_report.md) · [Solicitar Feature](../../issues/new?template=feature_request.md)

</div>

---

## Sobre o Projeto

O **BookMe** resolve um problema real e cotidiano: profissionais autônomos como barbeiros, psicólogos, personal trainers e fisioterapeutas gerenciam seus agendamentos pelo WhatsApp, resultando em conflitos de horário, esquecimentos e zero histórico de atendimentos.

O BookMe oferece uma plataforma SaaS multi-tenant onde cada prestador tem seu espaço isolado, podendo configurar seus serviços e disponibilidade, enquanto clientes realizam agendamentos online sem a necessidade de criar uma conta. Notificações automáticas são disparadas por e-mail e os prestadores têm controle total da sua agenda em tempo real.

> Este projeto é desenvolvido com fins educacionais e de portfólio, aplicando práticas de engenharia de software como Clean Architecture, SOLID, Design Patterns, observabilidade, mensageria, testes automatizados, CI/CD e IaC.

---

## Demonstração

> 🚧 Em desenvolvimento — prints e link de demo serão adicionados na v1.0.

---

## Stack Tecnológica

<table>
  <tr>
    <td valign="top" width="50%">

### Backend

| Camada          | Tecnologia                     |
| --------------- | ------------------------------ |
| Runtime         | Node.js 22 (LTS)               |
| Framework       | Fastify 5                      |
| Linguagem       | TypeScript 5                   |
| ORM             | Drizzle ORM                    |
| Banco Principal | PostgreSQL 16                  |
| Cache / Filas   | Redis 7                        |
| Mensageria      | BullMQ                         |
| Validação       | Zod                            |
| Docs da API     | Swagger (via @fastify/swagger) |
| Testes          | Vitest + Supertest             |
| Observabilidade | OpenTelemetry + Prometheus     |
| Containerização | Docker + Docker Compose        |

</td>
    <td valign="top" width="50%">

### Frontend

| Camada          | Tecnologia                     |
| --------------- | ------------------------------ |
| Framework       | React 19 + Vite                |
| Linguagem       | TypeScript 5                   |
| Roteamento      | TanStack Router                |
| Estado servidor | TanStack Query (React Query)   |
| Estado UI       | Zustand                        |
| Formulários     | React Hook Form + Zod          |
| UI Primitives   | Radix UI                       |
| Estilização     | TailwindCSS 4                  |
| Testes          | Vitest + React Testing Library |

### DevOps / Infra

| Camada     | Tecnologia     |
| ---------- | -------------- |
| CI/CD      | GitHub Actions |
| IaC        | Terraform      |
| Deploy API | Render / AWS   |
| Deploy Web | Vercel         |
| Registry   | Docker Hub     |

</td>
  </tr>
</table>

---

## Arquitetura do Sistema

```
┌──────────────────────────────────────────────────────┐
│                    Cliente (Browser)                 │
│              React SPA — Vite + TailwindCSS          │
└─────────────────────────┬────────────────────────────┘
                          │ HTTPS / REST
                          ▼
┌──────────────────────────────────────────────────────┐
│               API — Fastify Monolith                 │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────┐   │
│  │    Routes    │  │   Services   │  │  Workers  │   │
│  │  (Handlers)  │→ │  (Use Cases) │  │ (BullMQ)  │   │
│  └──────────────┘  └──────┬───────┘  └─────┬─────┘   │
│                           │                │         │
│  ┌────────────────────────▼────────────────▼──────┐  │
│  │              Repositories (Drizzle ORM)        │  │
│  └──────────────┬────────────────────────┬────────┘  │
└─────────────────┼────────────────────────┼───────────┘
                  │                        │
       ┌──────────▼─────────┐    ┌─────────▼───────┐
       │   PostgreSQL 16    │    │    Redis 7      │
       │  (dados principais)│    │  (cache + filas)│
       └────────────────────┘    └─────────────────┘
```

> Para a arquitetura detalhada, diagramas C4 e decisões de design, consulte a [Wiki — Arquitetura](../../wiki/Arquitetura).

---

## Estrutura do Repositório

```
bookme/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml               # Lint, testes e build em cada PR
│   │   └── cd.yml               # Deploy automático na main
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml
│   │   ├── feature_request.yml
│   │   └── task.yml
│   └── PULL_REQUEST_TEMPLATE.md
│
├── apps/
│   ├── api/                     # Fastify backend (Node + TypeScript)
│   │   ├── src/
│   │   │   ├── modules/         # Módulos de domínio (agendamentos, usuários...)
│   │   │   ├── shared/          # Erros, middlewares, utils, configs
│   │   │   ├── infra/           # Banco, Redis, e-mail, filas
│   │   │   └── server.ts        # Bootstrap da aplicação
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   ├── Dockerfile
│   │   └── package.json
│   │
│   └── web/                     # React SPA (Vite + TypeScript)
│       ├── src/
│       │   ├── pages/           # Páginas por rota
│       │   ├── components/      # Componentes reutilizáveis
│       │   ├── features/        # Funcionalidades (agendamento, dashboard...)
│       │   ├── hooks/           # Custom hooks
│       │   ├── store/           # Zustand stores
│       │   ├── services/        # Camada HTTP (fetch / axios)
│       │   └── lib/             # Configs (queryClient, router, etc.)
│       ├── tests/
│       └── package.json
│
├── packages/
│   └── shared/                  # Tipos e schemas Zod compartilhados
│       ├── src/
│       │   ├── schemas/         # Zod schemas reutilizados no web e api
│       │   └── types/           # Tipos TypeScript compartilhados
│       └── package.json
│
├── infra/
│   └── terraform/               # IaC — provisionamento da infraestrutura
│       ├── main.tf
│       ├── variables.tf
│       └── outputs.tf
│
├── docs/
│   └── adr/                     # Architecture Decision Records
│       └── 0001-estrategia-autenticacao.md
│
├── docker-compose.yml           # Ambiente de desenvolvimento local
├── docker-compose.prod.yml      # Referência para produção
├── .env.example                 # Variáveis de ambiente necessárias
├── .gitignore
├── turbo.json                   # Turborepo (monorepo task runner)
├── package.json                 # Root package.json (workspaces)
└── README.md
```

---

## Começando

### Pré-requisitos

- [Node.js 22+](https://nodejs.org/)
- [Docker](https://www.docker.com/) e Docker Compose
- [pnpm 9+](https://pnpm.io/) _(gerenciador de pacotes do monorepo)_

### Instalação e execução local

```bash
# 1. Clone o repositório
git clone https://github.com/SamuelLopess03/BookMe.git
cd bookme

# 2. Instale as dependências (todos os apps e packages)
pnpm install

# 3. Configure as variáveis de ambiente
cp .env.example .env
# Edite o .env com suas configurações locais

# 4. Suba os serviços de infraestrutura (PostgreSQL + Redis)
docker compose up -d

# 5. Rode as migrations do banco de dados
pnpm --filter api db:migrate

# 6. Inicie os servidores de desenvolvimento
pnpm dev
# api disponível em http://localhost:3333
# web disponível em http://localhost:5173
# swagger UI em http://localhost:3333/docs
```

### Rodando os testes

```bash
# Testes unitários (todos os apps)
pnpm test

# Testes de integração (requer Docker rodando)
pnpm test:integration

# Coverage
pnpm test:coverage
```

---

## Variáveis de Ambiente

Veja o arquivo [`.env.example`](./.env.example) para a lista completa e comentada de variáveis necessárias.

---

## Fluxo de Desenvolvimento

Este projeto segue o **GitHub Flow**. Para contribuir:

1. Abra ou escolha uma **Issue** existente
2. Crie uma branch a partir de `main`: `git checkout -b feat/nome-da-feature`
3. Desenvolva com commits semânticos: `feat:`, `fix:`, `chore:`, `docs:`, `test:`
4. Abra um **Pull Request** para `main` e preencha o template
5. O CI deve passar (lint + testes) antes do merge

> Consulte o [Guia de Desenvolvimento](../../wiki/Guia-de-Desenvolvimento) na Wiki para convenções detalhadas de commits, nomenclatura de branches e padrões de código.

---

## Documentação

A documentação completa do projeto está na **[Wiki do repositório](../../wiki)**:

| Página                                                        | Descrição                                  |
| ------------------------------------------------------------- | ------------------------------------------ |
| [Home](../../wiki)                                            | Visão geral e índice                       |
| [Visão Geral do Sistema](../../wiki/Visao-Geral-do-Sistema)   | Problema, solução e personas               |
| [Arquitetura](../../wiki/Arquitetura)                         | Decisões arquiteturais, diagramas C4, ADRs |
| [Modelagem do Banco](../../wiki/Modelagem-do-Banco-de-Dados)  | Schema, entidades e relacionamentos        |
| [Contratos da API](../../wiki/Contratos-da-API)               | Endpoints, autenticação e exemplos         |
| [Módulos do Sistema](../../wiki/Modulos-do-Sistema)           | Detalhamento de cada módulo de domínio     |
| [Observabilidade](../../wiki/Observabilidade)                 | Métricas, logs, traces e dashboards        |
| [Guia de Desenvolvimento](../../wiki/Guia-de-Desenvolvimento) | Setup, convenções e padrões de código      |
| [Infraestrutura e Deploy](../../wiki/Infraestrutura-e-Deploy) | CI/CD, Terraform e ambientes               |

---

## Roadmap

- [ ] **v0.1** — Setup do monorepo, CI/CD base, ambiente Docker
- [ ] **v0.2** — Autenticação (JWT + Refresh Token), multi-tenancy
- [ ] **v0.3** — Módulo de Prestadores e Serviços
- [ ] **v0.4** — Módulo de Agendamentos (criação e disponibilidade)
- [ ] **v0.5** — Notificações por e-mail (BullMQ + Workers)
- [ ] **v0.6** — Dashboard do prestador (frontend)
- [ ] **v0.7** — Página pública de agendamento (frontend)
- [ ] **v0.8** — Observabilidade (OpenTelemetry + Grafana)
- [ ] **v1.0** — Deploy em produção, documentação final

---

## Licença

Distribuído sob a licença MIT. Veja [`LICENSE`](./LICENSE) para mais informações.

---
