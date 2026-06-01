# SDD — Dashboard do Prestador

## BookMe · Spec Driven Development

**Documento:** `docs/specs/10-provider-dashboard.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `08-frontend-architecture.md` concluído  
**ADRs relacionados:** ADR-006 (TanStack Router), ADR-012 (State Management), ADR-013 (Formulários), ADR-015 (UI System)

---

## 1. Objetivo

Este documento especifica o dashboard do prestador de serviço — a área autenticada do BookMe onde o profissional gerencia sua agenda, visualiza e responde a agendamentos, cadastra serviços e configura sua disponibilidade semanal.

Ao final deste documento, você deve ser capaz de:

- Implementar todas as telas do dashboard com seus respectivos fluxos
- Compreender a estrutura de navegação e o layout compartilhado
- Implementar o gerenciamento de agendamentos (confirmar, rejeitar, cancelar)
- Implementar o cadastro de serviços com formulário validado
- Implementar a configuração de disponibilidade semanal
- Implementar a configuração do perfil e página pública

---

## 2. Estrutura de Navegação

```
/dashboard                     ← Visão geral (stats + próximos agendamentos)
/dashboard/appointments        ← Lista completa com filtros e ações
/dashboard/services            ← CRUD de serviços oferecidos
/dashboard/availability        ← Grade semanal de disponibilidade
/dashboard/profile             ← Perfil público + configurações da conta
```

**Layout compartilhado:** todas as rotas do dashboard herdam o `DashboardLayout`, que inclui a sidebar de navegação, o header com dados do prestador e o container principal de conteúdo.

---

## 3. Layout do Dashboard

```tsx
// apps/web/src/routes/_dashboard/route.tsx
import { Outlet, redirect } from "@tanstack/react-router";
import { useAuthStore } from "../../stores/auth.store";
import { DashboardSidebar } from "../../components/features/dashboard/DashboardSidebar";
import { DashboardHeader } from "../../components/features/dashboard/DashboardHeader";

// beforeLoad é executado antes de renderizar qualquer rota filha
export const Route = createFileRoute("/_dashboard")({
  beforeLoad: ({ context }) => {
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login", search: { redirect: location.href } });
    }
  },
  component: DashboardLayout,
});

function DashboardLayout() {
  return (
    <div className="flex h-screen bg-surface overflow-hidden">
      <DashboardSidebar />

      <div className="flex flex-col flex-1 overflow-hidden">
        <DashboardHeader />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/components/features/dashboard/DashboardSidebar.tsx
import { Link } from "@tanstack/react-router";
import { useAuthStore } from "../../../stores/auth.store";
import {
  CalendarDays,
  LayoutDashboard,
  Scissors,
  Clock,
  User,
  LogOut,
} from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Visão geral", icon: LayoutDashboard },
  { to: "/dashboard/appointments", label: "Agendamentos", icon: CalendarDays },
  { to: "/dashboard/services", label: "Serviços", icon: Scissors },
  { to: "/dashboard/availability", label: "Disponibilidade", icon: Clock },
  { to: "/dashboard/profile", label: "Perfil", icon: User },
];

export function DashboardSidebar() {
  const { tenant, clearAuth } = useAuthStore();

  return (
    <aside className="w-64 bg-white border-r border-border flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-border">
        <span className="text-xl font-bold text-primary">BookMe</span>
      </div>

      {/* Navegação */}
      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => (
          <Link
            key={to}
            to={to}
            activeProps={{
              className: "bg-primary/10 text-primary font-medium",
            }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-text-muted hover:bg-surface hover:text-text transition-colors"
          >
            <Icon className="w-5 h-5" />
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      {/* Rodapé: info do tenant + logout */}
      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-3 mb-3">
          {tenant?.avatarUrl ? (
            <img
              src={tenant.avatarUrl}
              className="w-8 h-8 rounded-full object-cover"
              alt=""
            />
          ) : (
            <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary font-semibold text-sm">
              {tenant?.name?.[0]?.toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{tenant?.name}</p>
            <p className="text-xs text-text-muted truncate">
              bookme.com.br/{tenant?.slug}
            </p>
          </div>
        </div>
        <button
          onClick={clearAuth}
          className="flex items-center gap-2 text-sm text-text-muted hover:text-destructive transition-colors w-full"
        >
          <LogOut className="w-4 h-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
```

---

## 4. Tela: Visão Geral (`/dashboard`)

Exibe as métricas do dia/semana e os próximos agendamentos que precisam de ação.

```tsx
// apps/web/src/routes/_dashboard/index.tsx
import { useQuery } from "@tanstack/react-query";
import { useAuthStore } from "../../stores/auth.store";
import { appointmentsQueryOptions } from "../../queries/appointments.queries";
import { StatsCard } from "../../components/features/dashboard/StatsCard";
import { AppointmentCard } from "../../components/features/dashboard/AppointmentCard";
import { CalendarDays, Clock, CheckCircle, XCircle } from "lucide-react";

export function DashboardPage() {
  const { tenant } = useAuthStore();

  // Pendentes: precisam de ação imediata
  const { data: pending } = useQuery(
    appointmentsQueryOptions({ status: "pending" }),
  );

  // Confirmados de hoje
  const { data: todayConfirmed } = useQuery(
    appointmentsQueryOptions({ status: "confirmed", date: "today" }),
  );

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold">
          Olá, {tenant?.name?.split(" ")[0]} 👋
        </h1>
        <p className="text-text-muted mt-1">Aqui está o resumo do seu dia.</p>
      </div>

      {/* Cards de estatísticas */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatsCard
          title="Hoje"
          value={todayConfirmed?.data?.length ?? 0}
          label="confirmados"
          icon={CalendarDays}
          color="primary"
        />
        <StatsCard
          title="Aguardando"
          value={pending?.data?.length ?? 0}
          label="pendentes"
          icon={Clock}
          color="warning"
          urgent={Boolean(pending?.data?.length)}
        />
      </div>

      {/* Agendamentos pendentes de ação */}
      {pending?.data?.length > 0 && (
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-warning" />
            Aguardando sua resposta ({pending.data.length})
          </h2>
          <div className="space-y-3">
            {pending.data.map((apt: any) => (
              <AppointmentCard key={apt.id} appointment={apt} showActions />
            ))}
          </div>
        </section>
      )}

      {/* Próximos confirmados */}
      <section>
        <h2 className="text-lg font-semibold mb-4">Próximos agendamentos</h2>
        <div className="space-y-3">
          {todayConfirmed?.data?.map((apt: any) => (
            <AppointmentCard key={apt.id} appointment={apt} />
          ))}
          {todayConfirmed?.data?.length === 0 && (
            <p className="text-text-muted text-sm p-4 text-center bg-surface rounded-lg border border-border">
              Nenhum agendamento confirmado para hoje.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
```

### AppointmentCard com Ações

```tsx
// apps/web/src/components/features/dashboard/AppointmentCard.tsx
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../../lib/api";
import { CheckCircle, XCircle, Clock } from "lucide-react";
import { toast } from "../../../components/ui/toast";

interface Props {
  appointment: {
    id: string;
    status: string;
    clientName: string;
    clientEmail: string;
    clientPhone: string | null;
    scheduledAt: string;
    service: { name: string; durationMinutes: number; priceCents: number };
  };
  showActions?: boolean;
}

const STATUS_CONFIG = {
  pending: { label: "Pendente", color: "text-warning  bg-warning/10" },
  confirmed: { label: "Confirmado", color: "text-secondary bg-secondary/10" },
  cancelled: {
    label: "Cancelado",
    color: "text-destructive bg-destructive/10",
  },
  completed: { label: "Concluído", color: "text-text-muted bg-surface" },
  rejected: { label: "Recusado", color: "text-destructive bg-destructive/10" },
};

export function AppointmentCard({ appointment, showActions }: Props) {
  const queryClient = useQueryClient();

  const updateStatus = useMutation({
    mutationFn: (status: string) =>
      api.patch(`/appointments/${appointment.id}/status`, { status }),
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ["appointments"] });
      const label = status === "confirmed" ? "confirmado" : "recusado";
      toast.success(`Agendamento ${label}.`);
    },
    onError: () => toast.error("Erro ao atualizar agendamento."),
  });

  const statusConfig =
    STATUS_CONFIG[appointment.status as keyof typeof STATUS_CONFIG];
  const formattedDate = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(appointment.scheduledAt));

  return (
    <div className="bg-white rounded-xl border border-border p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <p className="font-medium truncate">{appointment.clientName}</p>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusConfig.color}`}
            >
              {statusConfig.label}
            </span>
          </div>
          <p className="text-sm text-primary font-medium">
            {appointment.service.name}
          </p>
          <p className="text-sm text-text-muted mt-1 capitalize">
            {formattedDate}
          </p>
          <p className="text-xs text-text-muted">
            {appointment.service.durationMinutes} min
          </p>
        </div>

        <div className="text-right shrink-0">
          <p className="font-semibold text-text">
            {new Intl.NumberFormat("pt-BR", {
              style: "currency",
              currency: "BRL",
            }).format(appointment.service.priceCents / 100)}
          </p>
        </div>
      </div>

      {/* Dados de contato */}
      <div className="mt-3 pt-3 border-t border-border flex gap-4 text-sm text-text-muted">
        <span>{appointment.clientEmail}</span>
        {appointment.clientPhone && <span>{appointment.clientPhone}</span>}
      </div>

      {/* Botões de ação — apenas para agendamentos pendentes */}
      {showActions && appointment.status === "pending" && (
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => updateStatus.mutate("confirmed")}
            disabled={updateStatus.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg bg-secondary text-white text-sm font-medium hover:bg-secondary/90 disabled:opacity-50 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Confirmar
          </button>
          <button
            onClick={() => updateStatus.mutate("rejected")}
            disabled={updateStatus.isPending}
            className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-lg border border-destructive text-destructive text-sm font-medium hover:bg-destructive/5 disabled:opacity-50 transition-colors"
          >
            <XCircle className="w-4 h-4" />
            Recusar
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 5. Tela: Agendamentos (`/dashboard/appointments`)

Lista completa com filtros por status e paginação cursor-based.

```tsx
// apps/web/src/routes/_dashboard/appointments.tsx
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { AppointmentCard } from "../../components/features/dashboard/AppointmentCard";
import { useAuthStore } from "../../stores/auth.store";

const STATUS_FILTERS = [
  { value: undefined, label: "Todos" },
  { value: "pending", label: "Pendentes" },
  { value: "confirmed", label: "Confirmados" },
  { value: "completed", label: "Concluídos" },
  { value: "cancelled", label: "Cancelados" },
];

export function AppointmentsPage() {
  const [activeFilter, setActiveFilter] = useState<string | undefined>(
    undefined,
  );

  // Infinite query para paginação cursor-based
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isPending } =
    useInfiniteQuery({
      queryKey: ["appointments", "list", activeFilter],
      queryFn: ({ pageParam }) =>
        api
          .get("/appointments", {
            params: {
              status: activeFilter,
              cursor: pageParam,
              limit: 20,
            },
          })
          .then((r) => r.data),
      getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      initialPageParam: undefined as string | undefined,
    });

  const allAppointments = data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Agendamentos</h1>

      {/* Filtros de status */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.label}
            onClick={() => setActiveFilter(filter.value)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors
              ${
                activeFilter === filter.value
                  ? "bg-primary text-white"
                  : "bg-surface border border-border text-text-muted hover:border-primary hover:text-primary"
              }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {isPending ? (
        <AppointmentListSkeleton />
      ) : allAppointments.length === 0 ? (
        <div className="text-center py-16 text-text-muted">
          <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>Nenhum agendamento encontrado.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {allAppointments.map((apt) => (
            <AppointmentCard
              key={apt.id}
              appointment={apt}
              showActions={apt.status === "pending"}
            />
          ))}
        </div>
      )}

      {/* Carregar mais */}
      {hasNextPage && (
        <div className="mt-6 text-center">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="px-6 py-2 rounded-lg border border-border text-sm text-text-muted hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
          >
            {isFetchingNextPage ? "Carregando..." : "Carregar mais"}
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 6. Tela: Serviços (`/dashboard/services`)

CRUD completo de serviços com modal de criação/edição.

```tsx
// apps/web/src/routes/_dashboard/services.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { api } from "../../lib/api";
import {
  serviceSchema,
  type ServiceInput,
} from "../../../../packages/shared/schemas/service.schema";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { toast } from "../../components/ui/toast";

export function ServicesPage() {
  const [editingService, setEditingService] = useState<any | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["services"],
    queryFn: () => api.get("/services").then((r) => r.data),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/services/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      toast.success("Serviço removido.");
    },
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Serviços</h1>
        <button
          onClick={() => {
            setEditingService(null);
            setIsModalOpen(true);
          }}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary-hover transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo serviço
        </button>
      </div>

      {isPending ? (
        <ServicesSkeleton />
      ) : (
        <div className="space-y-3">
          {data?.services?.map((service: any) => (
            <div
              key={service.id}
              className="bg-white rounded-xl border border-border p-4 flex items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <p className="font-medium">{service.name}</p>
                <p className="text-sm text-text-muted mt-0.5">
                  {service.durationMinutes} min
                  {service.description && ` · ${service.description}`}
                </p>
              </div>
              <p className="font-semibold text-text shrink-0">
                {new Intl.NumberFormat("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                }).format(service.priceCents / 100)}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => {
                    setEditingService(service);
                    setIsModalOpen(true);
                  }}
                  className="p-2 text-text-muted hover:text-primary hover:bg-primary/10 rounded-lg transition-colors"
                  aria-label="Editar serviço"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (confirm(`Remover "${service.name}"?`)) {
                      deleteMutation.mutate(service.id);
                    }
                  }}
                  className="p-2 text-text-muted hover:text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                  aria-label="Remover serviço"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal de criação/edição */}
      <ServiceFormModal
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        service={editingService}
      />
    </div>
  );
}

function ServiceFormModal({
  open,
  onOpenChange,
  service,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  service: any | null;
}) {
  const queryClient = useQueryClient();
  const isEditing = Boolean(service);

  const form = useForm<ServiceInput>({
    resolver: zodResolver(serviceSchema),
    defaultValues: service
      ? {
          name: service.name,
          description: service.description ?? "",
          durationMinutes: service.durationMinutes,
          priceCents: service.priceCents,
        }
      : { name: "", description: "", durationMinutes: 60, priceCents: 0 },
  });

  const mutation = useMutation({
    mutationFn: (data: ServiceInput) =>
      isEditing
        ? api.put(`/services/${service.id}`, data)
        : api.post("/services", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["services"] });
      toast.success(isEditing ? "Serviço atualizado." : "Serviço criado.");
      onOpenChange(false);
      form.reset();
    },
    onError: (error: any) => {
      const apiError = error.response?.data;
      if (apiError?.errors) {
        apiError.errors.forEach(({ field, message }: any) =>
          form.setError(field, { message }),
        );
      } else {
        toast.error("Erro ao salvar serviço.");
      }
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Editar serviço" : "Novo serviço"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Campo: Nome */}
          <div>
            <label className="text-sm font-medium">Nome do serviço *</label>
            <input
              {...form.register("name")}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="Ex: Corte masculino"
            />
            {form.formState.errors.name && (
              <p className="text-destructive text-xs mt-1">
                {form.formState.errors.name.message}
              </p>
            )}
          </div>

          {/* Campo: Descrição */}
          <div>
            <label className="text-sm font-medium">Descrição</label>
            <input
              {...form.register("description")}
              className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="Opcional"
            />
          </div>

          {/* Campos: Duração e Preço lado a lado */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium">Duração (min) *</label>
              <input
                type="number"
                {...form.register("durationMinutes", { valueAsNumber: true })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="60"
                min={5}
                step={5}
              />
              {form.formState.errors.durationMinutes && (
                <p className="text-destructive text-xs mt-1">
                  {form.formState.errors.durationMinutes.message}
                </p>
              )}
            </div>
            <div>
              <label className="text-sm font-medium">Preço (R$) *</label>
              <input
                type="number"
                {...form.register("priceCents", {
                  setValueAs: (v) => Math.round(parseFloat(v) * 100),
                })}
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="50.00"
                min={0}
                step={0.01}
              />
              {form.formState.errors.priceCents && (
                <p className="text-destructive text-xs mt-1">
                  {form.formState.errors.priceCents.message}
                </p>
              )}
            </div>
          </div>

          {/* Ações */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="flex-1 py-2 rounded-lg border border-border text-sm text-text-muted hover:border-primary hover:text-primary transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={form.handleSubmit((data) => mutation.mutate(data))}
              disabled={mutation.isPending}
              className="flex-1 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover disabled:opacity-50 transition-colors"
            >
              {mutation.isPending
                ? "Salvando..."
                : isEditing
                  ? "Salvar"
                  : "Criar"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 7. Tela: Disponibilidade (`/dashboard/availability`)

Grade semanal onde o prestador define seus horários de trabalho e pode criar bloqueios pontuais.

```tsx
// apps/web/src/routes/_dashboard/availability.tsx
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { toast } from "../../components/ui/toast";

const DAYS_OF_WEEK = [
  { value: 1, label: "Segunda-feira" },
  { value: 2, label: "Terça-feira" },
  { value: 3, label: "Quarta-feira" },
  { value: 4, label: "Quinta-feira" },
  { value: 5, label: "Sexta-feira" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
];

export function AvailabilityPage() {
  const queryClient = useQueryClient();

  const { data, isPending } = useQuery({
    queryKey: ["availability", "schedules"],
    queryFn: () => api.get("/availability/schedules").then((r) => r.data),
  });

  const saveSchedule = useMutation({
    mutationFn: (payload: {
      dayOfWeek: number;
      schedules: Array<{ startTime: string; endTime: string }>;
    }) => api.put("/availability/schedules", payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["availability"] });
      toast.success("Disponibilidade salva.");
    },
    onError: () => toast.error("Erro ao salvar. Tente novamente."),
  });

  // Organiza os schedules por dia da semana
  const schedulesByDay = DAYS_OF_WEEK.reduce(
    (acc, day) => {
      acc[day.value] =
        data?.schedules?.filter((s: any) => s.dayOfWeek === day.value) ?? [];
      return acc;
    },
    {} as Record<number, any[]>,
  );

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Disponibilidade</h1>
        <p className="text-text-muted mt-1">
          Configure os horários em que você atende cada dia da semana.
        </p>
      </div>

      {isPending ? (
        <AvailabilitySkeleton />
      ) : (
        <div className="space-y-4">
          {DAYS_OF_WEEK.map((day) => (
            <DayScheduleEditor
              key={day.value}
              day={day}
              schedules={schedulesByDay[day.value]}
              onSave={(schedules) =>
                saveSchedule.mutate({ dayOfWeek: day.value, schedules })
              }
              isSaving={saveSchedule.isPending}
            />
          ))}
        </div>
      )}

      {/* Seção de bloqueios pontuais */}
      <div className="mt-10">
        <h2 className="text-lg font-semibold mb-4">Bloqueios pontuais</h2>
        <p className="text-text-muted text-sm mb-4">
          Bloqueie horários específicos para feriados, consultas ou outros
          compromissos.
        </p>
        <BlocksList />
      </div>
    </div>
  );
}

/**
 * Editor de janelas de horário para um dia.
 * Permite adicionar/remover múltiplas janelas (ex: 09h-12h e 14h-18h).
 */
function DayScheduleEditor({
  day,
  schedules,
  onSave,
  isSaving,
}: {
  day: { value: number; label: string };
  schedules: Array<{ startTime: string; endTime: string }>;
  onSave: (schedules: Array<{ startTime: string; endTime: string }>) => void;
  isSaving: boolean;
}) {
  const [windows, setWindows] = useState(schedules.length > 0 ? schedules : []);
  const [isEnabled, setIsEnabled] = useState(schedules.length > 0);
  const isDirty = JSON.stringify(windows) !== JSON.stringify(schedules);

  const addWindow = () =>
    setWindows((w) => [...w, { startTime: "09:00", endTime: "18:00" }]);

  const removeWindow = (index: number) =>
    setWindows((w) => w.filter((_, i) => i !== index));

  const updateWindow = (
    index: number,
    field: "startTime" | "endTime",
    value: string,
  ) =>
    setWindows((w) =>
      w.map((win, i) => (i === index ? { ...win, [field]: value } : win)),
    );

  return (
    <div className="bg-white rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          {/* Toggle de ativação do dia */}
          <button
            onClick={() => {
              setIsEnabled(!isEnabled);
              if (!isEnabled && windows.length === 0) addWindow();
            }}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors
              ${isEnabled ? "bg-primary" : "bg-border"}`}
          >
            <span
              className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform
              ${isEnabled ? "translate-x-5" : "translate-x-1"}`}
            />
          </button>
          <span
            className={`text-sm font-medium ${isEnabled ? "text-text" : "text-text-muted"}`}
          >
            {day.label}
          </span>
        </div>

        {isEnabled && isDirty && (
          <button
            onClick={() => onSave(isEnabled ? windows : [])}
            disabled={isSaving}
            className="text-xs px-3 py-1 bg-primary text-white rounded-full hover:bg-primary-hover disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Salvando..." : "Salvar"}
          </button>
        )}
      </div>

      {isEnabled && (
        <div className="space-y-2 mt-3">
          {windows.map((window, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                type="time"
                value={window.startTime}
                onChange={(e) =>
                  updateWindow(index, "startTime", e.target.value)
                }
                className="text-sm border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              <span className="text-text-muted text-sm">até</span>
              <input
                type="time"
                value={window.endTime}
                onChange={(e) => updateWindow(index, "endTime", e.target.value)}
                className="text-sm border border-border rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
              {windows.length > 1 && (
                <button
                  onClick={() => removeWindow(index)}
                  className="text-text-muted hover:text-destructive transition-colors"
                  aria-label="Remover janela"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addWindow}
            className="text-xs text-primary hover:underline mt-1"
          >
            + Adicionar horário
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## 8. Tela: Perfil (`/dashboard/profile`)

```tsx
// apps/web/src/routes/_dashboard/profile.tsx
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useAuthStore } from "../../stores/auth.store";
import {
  profileSchema,
  type ProfileInput,
} from "../../../../packages/shared/schemas/profile.schema";
import { toast } from "../../components/ui/toast";
import { ExternalLink } from "lucide-react";

export function ProfilePage() {
  const { tenant, setAuth } = useAuthStore();
  const queryClient = useQueryClient();

  const form = useForm<ProfileInput>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      name: tenant?.name ?? "",
      slug: tenant?.slug ?? "",
      bio: "",
      phone: "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: ProfileInput) => api.put("/tenants/profile", data),
    onSuccess: (response) => {
      // Atualiza os dados na store de auth para refletir na sidebar
      setAuth(useAuthStore.getState().accessToken!, response.data.tenant);
      toast.success("Perfil atualizado.");
    },
    onError: (error: any) => {
      const apiError = error.response?.data;
      if (apiError?.errors) {
        apiError.errors.forEach(({ field, message }: any) =>
          form.setError(field, { message }),
        );
      } else if (apiError?.status === 409) {
        form.setError("slug", { message: apiError.detail });
      } else {
        toast.error("Erro ao salvar perfil.");
      }
    },
  });

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold mb-2">Perfil</h1>
      <p className="text-text-muted mb-6">
        Esses dados aparecem na sua página pública de agendamentos.
      </p>

      {/* Link para a página pública */}
      <a
        href={`/${tenant?.slug}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 text-sm text-primary hover:underline mb-6"
      >
        <ExternalLink className="w-4 h-4" />
        bookme.com.br/{tenant?.slug}
      </a>

      <div className="space-y-4">
        {/* Nome */}
        <div>
          <label className="text-sm font-medium">Nome completo *</label>
          <input
            {...form.register("name")}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          {form.formState.errors.name && (
            <p className="text-destructive text-xs mt-1">
              {form.formState.errors.name.message}
            </p>
          )}
        </div>

        {/* Slug */}
        <div>
          <label className="text-sm font-medium">URL do seu perfil *</label>
          <div className="mt-1 flex items-center rounded-lg border border-border overflow-hidden focus-within:ring-2 focus-within:ring-primary/30 focus-within:border-primary">
            <span className="px-3 py-2 text-sm text-text-muted bg-surface border-r border-border shrink-0">
              bookme.com.br/
            </span>
            <input
              {...form.register("slug")}
              className="flex-1 px-3 py-2 text-sm focus:outline-none"
              placeholder="meu-perfil"
            />
          </div>
          {form.formState.errors.slug && (
            <p className="text-destructive text-xs mt-1">
              {form.formState.errors.slug.message}
            </p>
          )}
        </div>

        {/* Bio */}
        <div>
          <label className="text-sm font-medium">Sobre você</label>
          <textarea
            {...form.register("bio")}
            rows={3}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
            placeholder="Apresente-se para seus clientes"
          />
        </div>

        {/* Telefone */}
        <div>
          <label className="text-sm font-medium">Telefone / WhatsApp</label>
          <input
            {...form.register("phone")}
            className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="(85) 99999-0000"
          />
        </div>

        <button
          type="button"
          onClick={form.handleSubmit((data) => mutation.mutate(data))}
          disabled={mutation.isPending || !form.formState.isDirty}
          className="w-full py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          {mutation.isPending ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>
    </div>
  );
}
```

---

## 9. Checklist de Implementação

### Fase 1 — Layout e Navegação

- [ ] **#DASH-01** Implementar `DashboardLayout` com `beforeLoad` de proteção de rota
- [ ] **#DASH-02** Implementar `DashboardSidebar` com links ativos e logout
- [ ] **#DASH-03** Verificar redirecionamento para `/login` ao acessar dashboard sem autenticação

### Fase 2 — Visão Geral e Agendamentos

- [ ] **#DASH-04** Implementar `DashboardPage` (visão geral com stats e pendentes)
- [ ] **#DASH-05** Implementar `AppointmentCard` com ações de confirmar/rejeitar
- [ ] **#DASH-06** Implementar `AppointmentsPage` com filtros de status e `useInfiniteQuery`
- [ ] **#DASH-07** Testar: confirmar agendamento → card atualiza status sem refresh da página
- [ ] **#DASH-08** Testar: scroll na lista → "Carregar mais" busca próxima página com cursor

### Fase 3 — Serviços

- [ ] **#DASH-09** Implementar `ServicesPage` com listagem
- [ ] **#DASH-10** Implementar `ServiceFormModal` com React Hook Form + Zod (schema shared)
- [ ] **#DASH-11** Implementar soft delete de serviço (PATCH status → deleted)
- [ ] **#DASH-12** Testar: criar serviço → aparece na lista pública de agendamento
- [ ] **#DASH-13** Testar: erros de validação do servidor aparecem nos campos corretos do modal

### Fase 4 — Disponibilidade

- [ ] **#DASH-14** Implementar `AvailabilityPage` com `DayScheduleEditor` para cada dia
- [ ] **#DASH-15** Implementar toggle de ativação por dia com múltiplas janelas de horário
- [ ] **#DASH-16** Implementar `BlocksList` com criação e remoção de bloqueios pontuais
- [ ] **#DASH-17** Testar: alterar disponibilidade → cache de slots é invalidado no Redis
- [ ] **#DASH-18** Testar: criar bloqueio numa data com agendamentos existentes → slots cobertos ficam indisponíveis

### Fase 5 — Perfil

- [ ] **#DASH-19** Implementar `ProfilePage` com formulário de edição de perfil
- [ ] **#DASH-20** Testar: alterar slug → URL da página pública atualiza corretamente
- [ ] **#DASH-21** Testar: slug duplicado → erro aparece no campo, não apenas em toast

---

## 10. Referências

- ADR-006: TanStack Router → `docs/adr/0006-tanstack-router.md`
- ADR-012: State Management → `docs/adr/0012-state-management.md`
- ADR-013: Formulários → `docs/adr/0013-forms-strategy.md`
- ADR-015: UI System → `docs/adr/0015-ui-system.md`
- Spec 05: Endpoints de agendamentos → `docs/specs/05-appointments-module.md`
- Spec 04: Invalidação de cache ao mudar disponibilidade → `docs/specs/04-availability-engine.md`
