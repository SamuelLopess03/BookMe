# SDD — Notificações e Jobs em Background

## BookMe · Spec Driven Development

**Documento:** `docs/specs/06-notifications-jobs.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `05-appointments-module.md` concluído  
**ADRs relacionados:** ADR-004 (BullMQ), ADR-007 (Redis Queue), ADR-010 (Providers)

---

## 1. Objetivo

Este documento especifica o sistema de notificações assíncronas do BookMe: filas BullMQ, workers, tipos de jobs, templates, Dead Letter Queue e providers de envio. Notificações nunca bloqueiam o response HTTP — são publicadas na fila e processadas em background.

Ao final deste documento, você deve ser capaz de:

- Compreender quais jobs existem e quando são publicados
- Implementar os workers que processam cada tipo de job
- Implementar os providers de e-mail (Resend) e o MockProvider para testes
- Configurar retentativas e DLQ para diagnóstico de falhas

---

## 2. Tipos de Jobs

| Job                      | Publicado quando                      | Delay               |
| ------------------------ | ------------------------------------- | ------------------- |
| `booking-confirmed`      | Agendamento criado                    | Imediato            |
| `booking-cancelled`      | Agendamento cancelado                 | Imediato            |
| `reminder-24h`           | Agendamento criado                    | `scheduledAt - 24h` |
| `reminder-1h`            | Agendamento confirmado pelo prestador | `scheduledAt - 1h`  |
| `booking-status-changed` | Prestador confirma ou rejeita         | Imediato            |

---

## 3. Configuração das Filas

```typescript
// apps/api/src/modules/notifications/notification.queue.ts
import { Queue, Worker, QueueEvents } from "bullmq";
import { redisQueue } from "../../infra/redis/queue.client";

// Configurações de retry com backoff exponencial
const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: "exponential",
    delay: 2000, // 2s, 4s, 8s
  },
  removeOnComplete: { count: 100 }, // mantém os últimos 100 jobs completos
  removeOnFail: false, // jobs falhos ficam na DLQ para diagnóstico
};

export const notificationQueue = new Queue("notifications", {
  connection: redisQueue,
  defaultJobOptions,
});

// Fila separada para jobs mortos (DLQ)
export const notificationDLQ = new Queue("notifications:dlq", {
  connection: redisQueue,
});
```

---

## 4. Providers (Factory Pattern — ADR-010)

```typescript
// apps/api/src/modules/notifications/providers/notification.provider.ts
export interface NotificationPayload {
  to: string;
  template:
    | "booking-confirmed"
    | "booking-cancelled"
    | "reminder-24h"
    | "reminder-1h"
    | "booking-status-changed";
  data: Record<string, unknown>;
}

export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}
```

```typescript
// apps/api/src/modules/notifications/providers/resend.provider.ts
import { Resend } from "resend";
import type {
  NotificationProvider,
  NotificationPayload,
} from "./notification.provider";
import { env } from "../../../config/env";
import { renderEmailTemplate } from "../templates/email.templates";

export class ResendEmailProvider implements NotificationProvider {
  private readonly client = new Resend(env.RESEND_API_KEY);

  async send(payload: NotificationPayload): Promise<void> {
    const { subject, html } = renderEmailTemplate(
      payload.template,
      payload.data,
    );

    await this.client.emails.send({
      from: "BookMe <no-reply@bookme.com.br>",
      to: payload.to,
      subject,
      html,
    });
  }
}
```

```typescript
// apps/api/src/modules/notifications/providers/mock.provider.ts
import type {
  NotificationProvider,
  NotificationPayload,
} from "./notification.provider";

export class MockNotificationProvider implements NotificationProvider {
  public readonly sent: NotificationPayload[] = [];

  async send(payload: NotificationPayload): Promise<void> {
    this.sent.push(payload);
    console.log("[MockNotification]", payload.template, "→", payload.to);
  }
}
```

```typescript
// apps/api/src/modules/notifications/providers/notification.factory.ts
import type { NotificationProvider } from "./notification.provider";
import { ResendEmailProvider } from "./resend.provider";
import { MockNotificationProvider } from "./mock.provider";
import { env } from "../../../config/env";

export class NotificationFactory {
  static create(): NotificationProvider {
    if (env.NODE_ENV === "test") {
      return new MockNotificationProvider();
    }
    return new ResendEmailProvider();
  }
}
```

---

## 5. Templates de E-mail

```typescript
// apps/api/src/modules/notifications/templates/email.templates.ts

interface EmailTemplate {
  subject: string;
  html: string;
}

export function renderEmailTemplate(
  template: string,
  data: Record<string, unknown>,
): EmailTemplate {
  const templates: Record<string, EmailTemplate> = {
    "booking-confirmed": {
      subject: `✅ Agendamento confirmado — ${data.serviceName}`,
      html: `
        <h2>Seu agendamento foi criado!</h2>
        <p>Olá, <strong>${data.clientName}</strong>.</p>
        <p>Seu agendamento de <strong>${data.serviceName}</strong> está
           <strong>aguardando confirmação</strong> para
           <strong>${data.formattedDate}</strong>.</p>
        <p>
          <a href="${data.cancellationUrl}">Cancelar agendamento</a>
        </p>
      `,
    },
    "booking-cancelled": {
      subject: `❌ Agendamento cancelado — ${data.serviceName}`,
      html: `
        <h2>Agendamento cancelado</h2>
        <p>Olá, <strong>${data.clientName}</strong>.</p>
        <p>Seu agendamento de <strong>${data.serviceName}</strong> em
           <strong>${data.formattedDate}</strong> foi cancelado.</p>
      `,
    },
    "reminder-24h": {
      subject: `⏰ Lembrete: amanhã você tem ${data.serviceName}`,
      html: `
        <h2>Lembrete de agendamento</h2>
        <p>Olá, <strong>${data.clientName}</strong>!</p>
        <p>Seu agendamento de <strong>${data.serviceName}</strong> é
           <strong>amanhã às ${data.time}</strong>.</p>
        <p>
          <a href="${data.cancellationUrl}">Precisa cancelar? Clique aqui</a>
        </p>
      `,
    },
    "reminder-1h": {
      subject: `⏰ Em 1 hora: ${data.serviceName}`,
      html: `
        <h2>Seu atendimento começa em 1 hora!</h2>
        <p>Olá, <strong>${data.clientName}</strong>!</p>
        <p><strong>${data.serviceName}</strong> às <strong>${data.time}</strong>.</p>
      `,
    },
  };

  const found = templates[template];
  if (!found) throw new Error(`Template desconhecido: ${template}`);
  return found;
}
```

---

## 6. Worker

```typescript
// apps/api/src/modules/notifications/notification.worker.ts
import { Worker, UnrecoverableError } from "bullmq";
import { redisQueue } from "../../infra/redis/queue.client";
import { NotificationFactory } from "./providers/notification.factory";
import { notificationDLQ } from "./notification.queue";
import { db } from "../../infra/database/client";

export function startNotificationWorker() {
  const worker = new Worker(
    "notifications",
    async (job) => {
      const provider = NotificationFactory.create();

      // Busca dados do agendamento pelo ID
      const appointment = await db.query.appointments.findFirst({
        where: (a, { eq }) => eq(a.id, job.data.appointmentId),
        with: { service: true, tenant: true },
      });

      if (!appointment) {
        // Agendamento não existe — erro irrecuperável, não tenta de novo
        throw new UnrecoverableError(
          `Agendamento ${job.data.appointmentId} não encontrado`,
        );
      }

      const cancellationUrl = `${process.env.WEB_URL}/cancelar/${appointment.cancellationToken}`;

      const formattedDate = new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(appointment.scheduledAt);

      await provider.send({
        to: appointment.clientEmail,
        template: job.name as any,
        data: {
          clientName: appointment.clientName,
          serviceName: appointment.service.name,
          tenantName: appointment.tenant.name,
          formattedDate,
          time: formattedDate.split(" ")[formattedDate.split(" ").length - 1],
          cancellationUrl,
        },
      });
    },
    {
      connection: redisQueue,
      concurrency: 5, // processa até 5 jobs simultaneamente
    },
  );

  // Move jobs que falharam todas as tentativas para a DLQ
  worker.on("failed", async (job, error) => {
    if (job && job.attemptsMade >= (job.opts.attempts ?? 3)) {
      console.error(`[DLQ] Job ${job.id} movido para DLQ:`, error.message);
      await notificationDLQ.add(job.name, {
        ...job.data,
        failedReason: error.message,
        originalJobId: job.id,
      });
    }
  });

  console.log("✅ Worker de notificações iniciado");
  return worker;
}
```

Inicie o worker no `server.ts`:

```typescript
// apps/api/src/server.ts (adição)
import { startNotificationWorker } from "./modules/notifications/notification.worker";

// Após buildApp()...
startNotificationWorker();
```

---

## 7. Checklist de Implementação

- [ ] **#NOTIF-01** Instalar `bullmq`, `resend`, `ioredis`
- [ ] **#NOTIF-02** Implementar `notification.queue.ts` (fila principal + DLQ)
- [ ] **#NOTIF-03** Implementar `MockNotificationProvider` e testar que não faz chamadas reais
- [ ] **#NOTIF-04** Implementar `ResendEmailProvider` e testar com Resend sandbox
- [ ] **#NOTIF-05** Implementar `NotificationFactory` com branch de `NODE_ENV=test`
- [ ] **#NOTIF-06** Implementar templates de e-mail para os 4 tipos de notificação
- [ ] **#NOTIF-07** Implementar `notification.worker.ts` e iniciar no `server.ts`
- [ ] **#NOTIF-08** Testar: criar agendamento → verificar job `booking-confirmed` na fila (BullMQ Dashboard)
- [ ] **#NOTIF-09** Testar: job com e-mail inválido falha 3 vezes → aparece na DLQ
- [ ] **#NOTIF-10** Verificar que jobs de lembrete têm o delay correto em segundos

---

## 8. Referências

- ADR-004: BullMQ + Redis → `docs/adr/0004-bullmq-redis.md`
- ADR-010: Providers de Notificação → `docs/adr/0010-notification-providers.md`
- Spec 05: Onde os jobs são publicados → `docs/specs/05-appointments-module.md`
