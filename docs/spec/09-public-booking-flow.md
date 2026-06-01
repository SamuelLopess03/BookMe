# SDD — Fluxo de Agendamento Público

## BookMe · Spec Driven Development

**Documento:** `docs/specs/09-public-booking-flow.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `08-frontend-architecture.md` concluído  
**ADRs relacionados:** ADR-013 (Formulários), ADR-016 (Idempotência), ADR-015 (UI)

---

## 1. Objetivo

Este documento especifica o fluxo de agendamento público do BookMe — a experiência do cliente (sem conta) que acessa a página de um prestador e realiza um agendamento. É a feature mais visível do produto e deve ser impecável em termos de UX, acessibilidade e resiliência.

---

## 2. Fluxo de Navegação

```
/:tenantSlug
  │
  ├── Carrega perfil do prestador + lista de serviços
  │
  ├── PASSO 1 — Selecionar serviço
  │     └── Lista de serviços com nome, duração e preço
  │
  ├── PASSO 2 — Selecionar data
  │     └── Calendário mostrando apenas datas com disponibilidade
  │            └── GET /availability/:slug/dates?serviceId=...&start=...&end=...
  │
  ├── PASSO 3 — Selecionar horário
  │     └── Grade de slots disponíveis para a data escolhida
  │            └── GET /availability/:slug/slots?date=...&serviceId=...
  │
  ├── PASSO 4 — Preencher dados do cliente
  │     └── Nome, e-mail, telefone (opcional), observações (opcional)
  │
  └── PASSO 5 — Confirmação
        └── POST /appointments com Idempotency-Key
               └── Exibe resumo + link de cancelamento
```

---

## 3. BookingWizard — Componente Principal

```tsx
// apps/web/src/components/features/booking/BookingWizard.tsx
import { useRef, useState } from "react";
import { ServiceSelector } from "./ServiceSelector";
import { DatePicker } from "./DatePicker";
import { TimeSlotPicker } from "./TimeSlotPicker";
import { BookingForm } from "./BookingForm";
import { BookingConfirmation } from "./BookingConfirmation";

type WizardStep = "service" | "date" | "time" | "form" | "confirmed";

interface BookingState {
  serviceId?: string;
  serviceName?: string;
  date?: string; // YYYY-MM-DD
  timeSlot?: string; // HH:MM
}

interface Props {
  tenantSlug: string;
}

export function BookingWizard({ tenantSlug }: Props) {
  const [step, setStep] = useState<WizardStep>("service");
  const [state, setState] = useState<BookingState>({});
  const [result, setResult] = useState<{
    cancellationToken: string;
    scheduledAt: string;
  } | null>(null);

  // Gerado uma única vez na montagem — protege contra duplo submit (ADR-016)
  const idempotencyKey = useRef(crypto.randomUUID());

  const progress = {
    service: 1,
    date: 2,
    time: 3,
    form: 4,
    confirmed: 5,
  }[step];

  return (
    <div className="max-w-lg mx-auto p-6">
      {/* Indicador de progresso */}
      <BookingProgress current={progress} total={4} />

      {step === "service" && (
        <ServiceSelector
          tenantSlug={tenantSlug}
          onSelect={(serviceId, serviceName) => {
            setState((s) => ({ ...s, serviceId, serviceName }));
            setStep("date");
          }}
        />
      )}

      {step === "date" && state.serviceId && (
        <DatePicker
          tenantSlug={tenantSlug}
          serviceId={state.serviceId}
          onSelect={(date) => {
            setState((s) => ({ ...s, date }));
            setStep("time");
          }}
          onBack={() => setStep("service")}
        />
      )}

      {step === "time" && state.serviceId && state.date && (
        <TimeSlotPicker
          tenantSlug={tenantSlug}
          serviceId={state.serviceId}
          date={state.date}
          onSelect={(timeSlot) => {
            setState((s) => ({ ...s, timeSlot }));
            setStep("form");
          }}
          onBack={() => setStep("date")}
        />
      )}

      {step === "form" && state.serviceId && state.date && state.timeSlot && (
        <BookingForm
          tenantSlug={tenantSlug}
          serviceId={state.serviceId}
          date={state.date}
          timeSlot={state.timeSlot}
          idempotencyKey={idempotencyKey.current}
          onSuccess={(result) => {
            setResult(result);
            setStep("confirmed");
          }}
          onBack={() => setStep("time")}
        />
      )}

      {step === "confirmed" && result && (
        <BookingConfirmation
          serviceName={state.serviceName!}
          scheduledAt={result.scheduledAt}
          cancellationToken={result.cancellationToken}
        />
      )}
    </div>
  );
}
```

---

## 4. Componentes do Wizard

### 4.1 · ServiceSelector

```tsx
// apps/web/src/components/features/booking/ServiceSelector.tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../lib/api";

interface Props {
  tenantSlug: string;
  onSelect: (serviceId: string, serviceName: string) => void;
}

export function ServiceSelector({ tenantSlug, onSelect }: Props) {
  const { data, isPending } = useQuery({
    queryKey: ["services", tenantSlug],
    queryFn: () =>
      api.get(`/tenants/${tenantSlug}/services`).then((r) => r.data),
  });

  if (isPending) return <ServicesSkeleton />;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Escolha o serviço</h2>
      <ul className="space-y-3">
        {data?.services.map((service: any) => (
          <li key={service.id}>
            <button
              onClick={() => onSelect(service.id, service.name)}
              className="w-full text-left p-4 rounded-lg border border-border hover:border-primary hover:bg-surface transition-colors"
            >
              <div className="flex justify-between items-start">
                <div>
                  <p className="font-medium">{service.name}</p>
                  <p className="text-sm text-text-muted">
                    {service.durationMinutes} minutos
                  </p>
                </div>
                <span className="text-primary font-semibold">
                  {new Intl.NumberFormat("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  }).format(service.priceCents / 100)}
                </span>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

### 4.2 · BookingForm com Idempotência

```tsx
// apps/web/src/components/features/booking/BookingForm.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import {
  createAppointmentSchema,
  type CreateAppointmentInput,
} from "../../../../../packages/shared/schemas/appointment.schema";

interface Props {
  tenantSlug: string;
  serviceId: string;
  date: string;
  timeSlot: string;
  idempotencyKey: string;
  onSuccess: (result: {
    cancellationToken: string;
    scheduledAt: string;
  }) => void;
  onBack: () => void;
}

export function BookingForm({
  tenantSlug,
  serviceId,
  date,
  timeSlot,
  idempotencyKey,
  onSuccess,
  onBack,
}: Props) {
  const form = useForm<CreateAppointmentInput>({
    resolver: zodResolver(createAppointmentSchema),
    defaultValues: {
      tenantSlug,
      serviceId,
      scheduledAt: `${date}T${timeSlot}:00`,
    },
  });

  const mutation = useMutation({
    mutationFn: (data: CreateAppointmentInput) =>
      api
        .post("/appointments", data, {
          headers: { "Idempotency-Key": idempotencyKey },
        })
        .then((r) => r.data),
    onSuccess,
    onError: (error: any) => {
      const apiError = error.response?.data;
      if (apiError?.status === 409) {
        // Slot ocupado — volta para seleção de horário
        form.setError("root", { message: apiError.detail });
      } else if (apiError?.status === 422 && apiError?.errors) {
        apiError.errors.forEach(({ field, message }: any) => {
          form.setError(field, { message });
        });
      }
    },
  });

  return (
    <form onSubmit={form.handleSubmit((data) => mutation.mutate(data))}>
      <h2 className="text-xl font-semibold mb-4">Seus dados</h2>

      {form.formState.errors.root && (
        <p className="text-destructive text-sm mb-4 p-3 bg-destructive/10 rounded-lg">
          {form.formState.errors.root.message}
        </p>
      )}

      {/* campos: clientName, clientEmail, clientPhone, notes */}
      {/* ... campos com register() e exibição de erros */}

      <div className="flex gap-3 mt-6">
        <button type="button" onClick={onBack} className="flex-1 btn-secondary">
          Voltar
        </button>
        <button
          type="submit"
          disabled={mutation.isPending}
          className="flex-1 btn-primary"
        >
          {mutation.isPending ? "Confirmando..." : "Confirmar agendamento"}
        </button>
      </div>
    </form>
  );
}
```

---

## 5. Página de Cancelamento

```tsx
// apps/web/src/routes/cancelar/$token.tsx
import { useQuery, useMutation } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useParams } from "@tanstack/react-router";

export function CancellationPage() {
  const { token } = useParams({ from: "/cancelar/$token" });
  const [confirmed, setConfirmed] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post(`/appointments/cancel/${token}`),
    onSuccess: () => setConfirmed(true),
  });

  if (confirmed) {
    return (
      <div className="text-center p-8">
        <h1 className="text-2xl font-semibold mb-2">Agendamento cancelado</h1>
        <p className="text-text-muted">
          Seu agendamento foi cancelado com sucesso.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-sm mx-auto text-center p-8">
      <h1 className="text-2xl font-semibold mb-2">Cancelar agendamento</h1>
      <p className="text-text-muted mb-6">
        Tem certeza que deseja cancelar este agendamento?
      </p>
      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="btn-destructive w-full"
      >
        {mutation.isPending ? "Cancelando..." : "Sim, cancelar"}
      </button>
    </div>
  );
}
```

---

## 6. Checklist de Implementação

- [ ] **#PUB-01** Implementar `BookingWizard` com controle de steps e estado
- [ ] **#PUB-02** Implementar `ServiceSelector` com query de serviços do prestador
- [ ] **#PUB-03** Implementar `DatePicker` usando shadcn/ui Calendar + query de datas disponíveis
- [ ] **#PUB-04** Implementar `TimeSlotPicker` com grid visual de slots disponíveis/ocupados
- [ ] **#PUB-05** Implementar `BookingForm` com React Hook Form + Zod + Idempotency-Key
- [ ] **#PUB-06** Implementar `BookingConfirmation` com resumo e link de cancelamento
- [ ] **#PUB-07** Implementar página `/:tenantSlug` com perfil do prestador + BookingWizard
- [ ] **#PUB-08** Implementar página `/cancelar/:token` com confirmação
- [ ] **#PUB-09** Testar: duplo clique no botão → segundo request usa a mesma Idempotency-Key → só um agendamento criado
- [ ] **#PUB-10** Testar: slot ocupado durante o preenchimento → feedback de erro claro no step correto

---

## 7. Referências

- ADR-013: Formulários → `docs/adr/0013-forms-strategy.md`
- ADR-016: Idempotência → `docs/adr/0016-request-idempotency.md`
- Spec 04: Endpoints de disponibilidade → `docs/specs/04-availability-engine.md`
- Spec 05: Endpoint de criação de agendamento → `docs/specs/05-appointments-module.md`
