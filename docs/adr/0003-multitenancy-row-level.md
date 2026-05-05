# ADR-0003 — Multi-tenancy: Row-Level Isolation (RLS)

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Multi-tenancy e Isolamento de Dados

---

## Contexto

O **BookMe** é um SaaS multi-tenant. Os dados de cada prestador (tenant) devem ser completamente isolados. Um vazamento de dados onde um prestador visualiza agendamentos de outro seria um erro crítico de segurança e privacidade.

## Opções consideradas

| Opção | Isolamento | Complexidade Operacional |
| :--- | :--- | :--- |
| **Banco por Tenant** | Máximo | Muito alta (gerenciamento de N bancos) |
| **Schema por Tenant** | Alto | Alta (migrations complexas) |
| **Row-Level com `tenant_id` (escolhido)** | Médio/Alto | Baixa (uma única instância de banco) |

## Decisão

Adotar a estratégia de **Row-Level Isolation** utilizando duas camadas de defesa:

1.  **Lógica de Aplicação**: Todas as tabelas de domínio possuem obrigatoriamente a coluna `tenant_id UUID NOT NULL`. O `BaseRepository` filtra automaticamente todas as queries por este ID.
2.  **Lógica de Banco (RLS)**: Utilizar o **Row-Level Security** nativo do PostgreSQL. Mesmo que ocorra um bug no código, o banco de dados rejeitará queries que tentem acessar dados de outro tenant se o contexto da conexão não estiver correto.

## Consequências

- **Escalabilidade**: Facilidade extrema para adicionar novos tenants sem overhead de infraestrutura.
- **Manutenibilidade**: Uma única migration aplica mudanças em todos os tenants simultaneamente.
- **Segurança**: O RLS atua como uma rede de segurança vital contra erros de desenvolvimento (*"Defense in Depth"*).
- **Consultas**: Requer cuidado extra para garantir que o contexto do `tenant_id` seja injetado corretamente em todas as conexões de banco.
