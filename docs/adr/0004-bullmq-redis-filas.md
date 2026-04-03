# ADR-0004 — BullMQ + Redis para Filas de Mensageria

**Status:** Aceito  
**Data:** A definir

---

## Contexto

Envio de e-mails e lembretes agendados não devem bloquear o response HTTP. É necessário um mecanismo de filas para processar jobs em background.

## Decisão

BullMQ com Redis. O Redis já é necessário para cache, portanto não adiciona infraestrutura nova.

## Alternativas consideradas

| Opção                          | Vantagem                      | Desvantagem                           |
| ------------------------------ | ----------------------------- | ------------------------------------- |
| RabbitMQ                       | Padrão enterprise             | Infraestrutura adicional, curva maior |
| **BullMQ + Redis (escolhido)** | Redis já em uso, DX excelente | Redis torna-se ponto crítico          |
| setInterval simples            | Zero dependências             | Não sobrevive a restart, sem retry    |

## Consequências

- Redis crítico para dois usos (cache + filas) — requer configuração de persistência em produção
- Retry automático com backoff exponencial
- Dead letter queue para diagnóstico de falhas
