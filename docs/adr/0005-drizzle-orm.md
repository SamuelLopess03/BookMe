# ADR-0005 — Drizzle ORM em vez de Prisma

**Status:** Aceito  
**Data:** A definir

---

## Contexto

O sistema precisa de uma camada de abstração para o PostgreSQL com suporte a TypeScript, migrations e bom DX.

## Decisão

Drizzle ORM. Schema definido em TypeScript puro, queries type-safe sem geração de código, comportamento próximo ao SQL real.

## Alternativas consideradas

| Opção                       | Vantagem                          | Desvantagem                            |
| --------------------------- | --------------------------------- | -------------------------------------- |
| Prisma                      | Ecossistema maduro, Prisma Studio | Overhead de runtime, geração de código |
| **Drizzle ORM (escolhido)** | TypeScript-first, zero overhead   | Ecossistema menor                      |
| Knex                        | Controle SQL total                | Sem type safety nativa                 |

## Consequências

- Queries explícitas — o desenvolvedor sabe exatamente o SQL gerado
- Migrations geradas diretamente dos schemas TypeScript via Drizzle Kit
- Sem Prisma Studio — compensado com TablePlus ou DBeaver localmente
