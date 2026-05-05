# ADR-0002 — Estrutura de Monólito Modular

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Arquitetura de Sistemas e Organização de Código

---

## Contexto

O sistema possui múltiplos domínios funcionais (Auth, Agendamentos, Notificações, Disponibilidade). Precisamos decidir se cada domínio deve ser um serviço independente (microserviços) ou se devem coexistir em um único processo.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **Microserviços** | Escalabilidade independente | Complexidade operacional enorme para o estágio atual |
| **Monólito sem separação** | Máxima simplicidade inicial | Difícil de manter; vira "código espaguete" rápido |
| **Monólito Modular (escolhido)** | Organização interna + Simplicidade de deploy | Requer disciplina rigorosa para evitar acoplamento |

## Decisão

Adotar o padrão de **Monólito Modular**: um único processo Node.js com módulos de domínio fisicamente separados em pastas.

**Regras de Comunicação:**
- Módulos se comunicam via **interfaces** (contracts) ou **Domain Events**.
- Nunca utilizar `import` direto de lógica interna de um módulo para outro.
- Cada módulo deve ser "extraível" para um microserviço independente no futuro com o mínimo de esforço.

## Consequências

- **Deploy Simples**: Uma única unidade de deploy, monitoramento e escala (ideal para o MVP).
- **Integridade**: Transações de banco são simplificadas (ACID nativo no Postgres), sem necessidade de padrões complexos como SAGA ou Two-Phase Commit.
- **Evolução**: A separação clara facilita que times diferentes trabalhem em módulos diferentes sem conflitos constantes de código.
