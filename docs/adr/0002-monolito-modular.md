# ADR-0002 — Monólito Modular em vez de Microserviços

**Status:** Aceito  
**Data:** A definir

---

## Contexto

O sistema tem múltiplos domínios funcionais (auth, agendamentos, notificações, disponibilidade). A pergunta é: cada domínio deve ser um serviço independente?

## Decisão

Monólito modular: um único processo Node.js com módulos de domínio separados que se comunicam via interfaces e domain events — nunca por import direto entre serviços.

## Alternativas consideradas

| Opção                            | Vantagem                    | Desvantagem                                          |
| -------------------------------- | --------------------------- | ---------------------------------------------------- |
| Microserviços                    | Escalabilidade independente | Complexidade operacional enorme para o estágio atual |
| Monólito sem separação           | Máxima simplicidade         | Difícil de manter com crescimento                    |
| **Monólito Modular (escolhido)** | Simplicidade + organização  | Requer disciplina para evitar acoplamento            |

## Consequências

- Um único processo para deploy, monitoramento e escala
- Transações de banco simplificadas (sem two-phase commit)
- Separação interna facilita eventual extração de módulo para serviço independente se necessário
