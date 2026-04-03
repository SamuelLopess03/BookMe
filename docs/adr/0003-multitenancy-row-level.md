# ADR-0003 — Multi-tenancy por Row-Level com tenant_id

**Status:** Aceito  
**Data:** A definir

---

## Contexto

O sistema é multi-tenant. Os dados de cada prestador devem ser completamente isolados dos demais.

## Decisão

Row-Level tenancy: todas as tabelas de domínio têm coluna `tenant_id UUID NOT NULL`. PostgreSQL Row-Level Security como segunda camada de proteção.

## Alternativas consideradas

| Opção                                   | Isolamento | Complexidade operacional |
| --------------------------------------- | ---------- | ------------------------ |
| Banco por tenant                        | Máximo     | Muito alta               |
| Schema por tenant                       | Alto       | Alta                     |
| **Row-Level com tenant_id (escolhido)** | Adequado   | Baixa                    |

## Consequências

- Uma única migration para todos os tenants
- RLS protege contra bugs de aplicação
- BaseRepository sempre filtra por `tenant_id` automaticamente
