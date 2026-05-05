# ADR-0005 — Persistência: Drizzle ORM

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Camada de Dados e TypeScript DX

---

## Contexto

O **BookMe** requer uma camada de abstração para o PostgreSQL que ofereça segurança de tipos (Type Safety), facilite migrations e mantenha a performance próxima ao SQL puro.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **Prisma** | Ecossistema maduro; Prisma Studio é excelente | Overhead de runtime (binary); geração de código complexa; performance inferior em joins complexos |
| **Drizzle ORM (escolhido)** | **TypeScript-first**; zero overhead; SQL-like; excelente performance | Ecossistema mais recente; requer mais conhecimento de SQL |
| **Knex.js / Kysely** | Controle total do SQL | Knex carece de type-safety nativa; Kysely requer configuração manual extensa de tipos |

## Decisão

Adotar o **Drizzle ORM** como a ferramenta principal de persistência. A decisão baseia-se na filosofia de "SQL que escala com TypeScript", onde o schema é definido em TS puro e o resultado é um código leve, rápido e sem surpresas de performance.

**Diferenciais adotados:**
- **Drizzle Kit**: Utilizado para gerenciar migrations automáticas a partir dos schemas.
- **Relational Queries**: Utilizaremos a API relacional do Drizzle para facilitar buscas complexas sem perder o controle do SQL gerado.

## Consequências

- **Performance**: Redução do cold start e do consumo de memória em comparação ao Prisma, sendo ideal para ambientes serverless ou containers enxutos.
- **Transparência**: O desenvolvedor tem total visibilidade do SQL gerado, facilitando a depuração e otimização de queries.
- **Segurança de Tipos**: Erros de banco de dados são capturados em tempo de compilação, prevenindo uma classe inteira de bugs em produção.
