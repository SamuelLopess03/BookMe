# SDD — Observabilidade

## BookMe · Spec Driven Development

**Documento:** `docs/specs/07-observability.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `02-backend-architecture.md` concluído  
**ADRs relacionados:** ADR-002 (Monólito Modular), ADR-008 (traceId nos erros)

---

## 1. Objetivo

Este documento especifica a camada de observabilidade do BookMe: instrumentação com OpenTelemetry, coleta de métricas com Prometheus, visualização com Grafana e tracing distribuído com Jaeger. Observabilidade é implementada transversalmente — não é um módulo, mas uma capacidade que atravessa todos os outros.

**Os três pilares:**

```
LOGS    → O que aconteceu?         (Pino — já integrado no Fastify)
MÉTRICAS → Quantas vezes? Em quanto tempo? (Prometheus + Grafana)
TRACES   → Por qual caminho?        (OpenTelemetry + Jaeger)
```

---

## 2. OpenTelemetry — Instrumentação

```typescript
// apps/api/src/infra/telemetry/tracer.ts
// IMPORTANTE: este arquivo deve ser importado ANTES de qualquer outro módulo
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { HttpInstrumentation } from "@opentelemetry/instrumentation-http";
import { FastifyInstrumentation } from "@opentelemetry/instrumentation-fastify";
import { PgInstrumentation } from "@opentelemetry/instrumentation-pg";
import { IORedisInstrumentation } from "@opentelemetry/instrumentation-ioredis";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const sdk = new NodeSDK({
  resource: new Resource({
    [ATTR_SERVICE_NAME]: "bookme-api",
  }),
  traceExporter: new OTLPTraceExporter({
    url:
      process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://jaeger:4318/v1/traces",
  }),
  instrumentations: [
    new HttpInstrumentation(),
    new FastifyInstrumentation(),
    new PgInstrumentation(), // traces das queries PostgreSQL
    new IORedisInstrumentation(), // traces das operações Redis
  ],
});

sdk.start();
console.log("✅ OpenTelemetry iniciado");

process.on("SIGTERM", () => sdk.shutdown());
```

No `package.json`, adicione o `--require` para que o tracer carregue antes do app:

```json
{
  "scripts": {
    "start": "node --require ./dist/infra/telemetry/tracer.js dist/server.js"
  }
}
```

---

## 3. Métricas Prometheus

```typescript
// apps/api/src/infra/telemetry/metrics.ts
import { Registry, Counter, Histogram, Gauge } from "prom-client";

export const metricsRegistry = new Registry();

// ── Métricas de HTTP ──────────────────────────────────────────
export const httpRequestsTotal = new Counter({
  name: "bookme_http_requests_total",
  help: "Total de requisições HTTP recebidas",
  labelNames: ["method", "route", "status_code"],
  registers: [metricsRegistry],
});

export const httpRequestDurationMs = new Histogram({
  name: "bookme_http_request_duration_ms",
  help: "Duração das requisições HTTP em milissegundos",
  labelNames: ["method", "route", "status_code"],
  buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [metricsRegistry],
});

// ── Métricas de Negócio ───────────────────────────────────────
export const appointmentsCreatedTotal = new Counter({
  name: "bookme_appointments_created_total",
  help: "Total de agendamentos criados",
  registers: [metricsRegistry],
});

export const appointmentsCancelledTotal = new Counter({
  name: "bookme_appointments_cancelled_total",
  help: "Total de agendamentos cancelados",
  labelNames: ["cancelled_by"],
  registers: [metricsRegistry],
});

export const slotConflictsTotal = new Counter({
  name: "bookme_slot_conflicts_total",
  help: "Total de tentativas de agendamento em slot já ocupado",
  registers: [metricsRegistry],
});

// ── Métricas de Fila ──────────────────────────────────────────
export const notificationJobsTotal = new Counter({
  name: "bookme_notification_jobs_total",
  help: "Total de jobs de notificação processados",
  labelNames: ["type", "status"], // status: completed | failed
  registers: [metricsRegistry],
});

export const notificationDLQSize = new Gauge({
  name: "bookme_notification_dlq_size",
  help: "Número de jobs na Dead Letter Queue",
  registers: [metricsRegistry],
});

// ── Cache ──────────────────────────────────────────────────────
export const cacheHitsTotal = new Counter({
  name: "bookme_cache_hits_total",
  help: "Cache hits no Redis de disponibilidade",
  registers: [metricsRegistry],
});

export const cacheMissesTotal = new Counter({
  name: "bookme_cache_misses_total",
  help: "Cache misses no Redis de disponibilidade",
  registers: [metricsRegistry],
});
```

**Endpoint de métricas (adicionado no `app.ts`):**

```typescript
// Rota de scraping do Prometheus — não exposta publicamente em produção
app.get("/metrics", async (request, reply) => {
  reply.header("Content-Type", metricsRegistry.contentType);
  return metricsRegistry.metrics();
});
```

**Hook para coletar métricas HTTP automaticamente:**

```typescript
// apps/api/src/infra/telemetry/metrics.hook.ts
import type { FastifyInstance } from "fastify";
import { httpRequestsTotal, httpRequestDurationMs } from "./metrics";

export function registerMetricsHooks(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    request.startTime = Date.now();
  });

  app.addHook("onResponse", async (request, reply) => {
    const duration = Date.now() - (request.startTime ?? Date.now());
    const route = request.routeOptions?.url ?? request.url;

    httpRequestsTotal
      .labels(request.method, route, String(reply.statusCode))
      .inc();
    httpRequestDurationMs
      .labels(request.method, route, String(reply.statusCode))
      .observe(duration);
  });
}
```

---

## 4. Docker Compose — Stack de Observabilidade

```yaml
# docker-compose.observability.yml
version: "3.9"

services:
  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports:
      - "16686:16686" # UI do Jaeger
      - "4318:4318" # OTLP HTTP (traces)
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

  prometheus:
    image: prom/prometheus:v2.51.0
    ports:
      - "9090:9090"
    volumes:
      - ./config/prometheus.yml:/etc/prometheus/prometheus.yml
    command:
      - "--config.file=/etc/prometheus/prometheus.yml"
      - "--storage.tsdb.retention.time=15d"

  grafana:
    image: grafana/grafana:10.4.0
    ports:
      - "3000:3000"
    environment:
      GF_SECURITY_ADMIN_PASSWORD: bookme123
    volumes:
      - grafana_data:/var/lib/grafana
      - ./config/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./config/grafana/datasources:/etc/grafana/provisioning/datasources

volumes:
  grafana_data:
```

```yaml
# config/prometheus.yml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "bookme-api"
    static_configs:
      - targets: ["host.docker.internal:3333"]
    metrics_path: "/metrics"
```

---

## 5. Dashboards Grafana Recomendados

Crie painéis para:

**Painel 1 — API Health:**

- Taxa de requisições por segundo (req/s)
- Latência P50, P95, P99 por rota
- Taxa de erros (status 4xx e 5xx)

**Painel 2 — Negócio:**

- Agendamentos criados por hora
- Taxa de cancelamentos (total e por quem)
- Conflitos de slot por hora

**Painel 3 — Background Jobs:**

- Jobs processados por minuto
- Taxa de falha de notificações
- Tamanho atual da DLQ

**Painel 4 — Cache:**

- Taxa de cache hit/miss (hit ratio ideal: >80%)
- Latência do Redis cache

---

## 6. Checklist de Implementação

- [ ] **#OBS-01** Instalar `@opentelemetry/sdk-node`, instrumentações e exportadores
- [ ] **#OBS-02** Implementar `tracer.ts` e configurar `--require` no start script
- [ ] **#OBS-03** Instalar `prom-client` e implementar `metrics.ts`
- [ ] **#OBS-04** Registrar endpoint `/metrics` e hook de coleta automática
- [ ] **#OBS-05** Configurar `docker-compose.observability.yml` com Jaeger, Prometheus e Grafana
- [ ] **#OBS-06** Verificar traces no Jaeger: fazer uma requisição e ver o span no UI `:16686`
- [ ] **#OBS-07** Verificar métricas no Prometheus: acessar `:9090` e fazer query `bookme_http_requests_total`
- [ ] **#OBS-08** Criar painel básico no Grafana com latência P95 e taxa de erro
- [ ] **#OBS-09** Adicionar `traceId` no `error-handler.ts` (ADR-008) via `trace.getActiveSpan()?.spanContext().traceId`

---

## 7. Referências

- ADR-008: `traceId` nos erros → `docs/adr/0008-api-error-format.md`
- [OpenTelemetry Node.js](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/)
- [prom-client](https://github.com/siimon/prom-client)
- [Jaeger Getting Started](https://www.jaegertracing.io/docs/latest/getting-started/)
