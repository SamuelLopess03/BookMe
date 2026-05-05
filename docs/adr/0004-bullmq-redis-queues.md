# ADR-0004 — Mensageria: BullMQ + Redis para Processamento em Background

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Infraestrutura e Processamento Assíncrono

---

## Contexto

Operações como envio de e-mails, lembretes de agendamento (24h/1h antes) e processamento de webhooks não devem bloquear o fluxo principal da requisição HTTP. É necessário um mecanismo de filas robusto que suporte retentativas automáticas e agendamento de tarefas futuras.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **RabbitMQ** | Altamente escalável; padrão enterprise | Infraestrutura adicional complexa; curva de aprendizado alta |
| **BullMQ + Redis (escolhido)** | **Redis já em uso** para cache; DX excelente; suporte nativo a agendamentos | Redis torna-se ponto único de falha e requer configuração de persistência |
| **setInterval/setTimeout** | Zero dependências | Não sobrevive a restarts; sem monitoramento ou retry |

## Decisão

Utilizar o **BullMQ** sobre **Redis** como solução de mensageria. O BullMQ foi escolhido por ser o padrão de mercado no ecossistema Node.js, oferecendo suporte nativo a:
1.  **Delayed Jobs**: Essencial para lembretes (ex: agendar notificação para daqui a 23 horas).
2.  **Retries com Backoff**: Tentativas automáticas com tempo crescente entre falhas.
3.  **Priorização**: Garantir que confirmações de agendamento saiam antes de relatórios.

## Consequências

- **Infraestrutura**: O Redis assume um papel crítico. Deve ser configurado com `appendonly yes` (AOF) para garantir que as filas não sejam perdidas em caso de restart.
- **Resiliência**: Falhas temporárias em providers externos (como Resend ou Twilio) são resolvidas automaticamente via retries.
- **Observabilidade**: Possibilidade de usar ferramentas como o **BullBoard** para monitorar filas em tempo real no dashboard administrativo.
