# ADR-0007 — Redis Dual-Instance: Separação entre Cache e Filas

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Infraestrutura de Backend (Cache e Mensageria)

---

## Contexto

O projeto utiliza Redis para dois propósitos distintos: cache de disponibilidade e filas de mensageria via BullMQ (ADR-0004). O problema é que essas duas responsabilidades exigem políticas de memória (`maxmemory-policy`) mutuamente incompatíveis numa mesma instância Redis.

O BullMQ exige `noeviction` — o Redis nunca pode descartar chaves arbitrariamente, pois um job deletado silenciosamente é uma notificação perdida sem qualquer log ou alerta. O cache de disponibilidade, por outro lado, se beneficia de `allkeys-lru` (Least Recently Used) — quando a memória enche, os dados menos acessados são descartados, o que é o comportamento correto e esperado de um cache.

Rodar ambos na mesma instância com `noeviction` significa que o Redis pode travar ao encher a memória enquanto está servindo cache. Rodar com `allkeys-lru` significa que jobs do BullMQ podem ser evictados silenciosamente.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **Instância única com `noeviction`** | Infraestrutura simples | Cache nunca libera memória; risco de OOM |
| **Instância única com `allkeys-lru`** | Cache funciona corretamente | Jobs do BullMQ podem ser deletados silenciosamente |
| **Dual-Instance: Redis separado por responsabilidade** | Cada instância com policy correta | Dois processos Redis para gerenciar |
| **Dual-database no mesmo processo (DB 0 e DB 1)** | Processo único, configuração simples | Databases compartilham a mesma `maxmemory-policy` — não resolve o problema |

## Decisão

Utilizar **duas instâncias Redis separadas** com configurações distintas:

*   **Redis Cache (`redis-cache`)**: porta 6379, política `allkeys-lru`, `maxmemory 256mb`. Responsável pelo cache-aside de slots de disponibilidade.
*   **Redis Queue (`redis-queue`)**: porta 6380, política `noeviction`, persistência AOF habilitada (`appendonly yes`). Responsável exclusivamente pelo BullMQ.

Em desenvolvimento, ambas as instâncias são declaradas no `docker-compose.yml`. Em produção, são dois serviços Redis independentes (ex.: dois Redis Managed no Railway, Render ou AWS ElastiCache).

```yaml
# docker-compose.yml (fragmento)
services:
  redis-cache:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    ports:
      - "6379:6379"

  redis-queue:
    image: redis:7-alpine
    command: redis-server --maxmemory-policy noeviction --appendonly yes
    ports:
      - "6380:6380"
```

As variáveis de ambiente refletem a separação:
```env
REDIS_CACHE_URL=redis://localhost:6379
REDIS_QUEUE_URL=redis://localhost:6380
```

## Consequências

- Cada instância opera com a política de memória correta para seu propósito.
- Jobs do BullMQ jamais são evictados silenciosamente em condições de pressão de memória.
- O cache pode expirar entradas antigas normalmente sem afetar as filas.
- Custo de infraestrutura ligeiramente maior em produção (dois serviços Redis).
- A configuração de conexão no código deve ser explícita: `new Queue(..., { connection: redisQueueClient })` e `redisCache.set(...)` usam clientes distintos.