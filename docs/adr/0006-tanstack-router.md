# ADR-0006 — TanStack Router para Roteamento Client-Side

**Status:** Aceito  
**Data:** A definir

---

## Contexto

O frontend é uma SPA e precisa de um router client-side com suporte a TypeScript end-to-end, route loaders e integração com React Query.

## Decisão

TanStack Router pela segurança de tipos completa: URLs, parâmetros de rota e search params são tipados em TypeScript. Route loaders garantem dados disponíveis antes de renderizar.

## Alternativas consideradas

| Opção                           | Vantagem                        | Desvantagem                                   |
| ------------------------------- | ------------------------------- | --------------------------------------------- |
| React Router v7                 | Maior adoção, familiar          | Type safety limitada sem configurações extras |
| **TanStack Router (escolhido)** | Full type-safe, loaders nativos | Mais novo, comunidade menor                   |

## Consequências

- Links e navegações completamente tipados — erros de URL capturados em compile time
- Integração nativa com TanStack Query para prefetch de dados por rota
- Curva de aprendizado ligeiramente maior que React Router
