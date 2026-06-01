# SDD — Arquitetura do Frontend

## BookMe · Spec Driven Development

**Documento:** `docs/specs/08-frontend-architecture.md`  
**Status:** Draft  
**Versão:** 1.0  
**Pré-requisito:** `02-backend-architecture.md` concluído (API em execução)  
**ADRs relacionados:** ADR-006 (TanStack Router), ADR-011 (Zod Shared), ADR-012 (State Management), ADR-013 (Formulários), ADR-014 (Testes), ADR-015 (UI System)

---

## 1. Objetivo

Este documento especifica a arquitetura completa do frontend React do BookMe: estrutura de pastas, configuração do TanStack Router, setup do TanStack Query, cliente HTTP, gerenciamento de autenticação, sistema de componentes e configuração de testes.

É a fundação sobre a qual os fluxos de usuário (booking público e dashboard do prestador) são construídos.

---

## 2. Estrutura de Pastas

```
apps/web/
├── src/
│   ├── main.tsx                  ← Entry point React
│   ├── router.tsx                ← Definição das rotas (TanStack Router)
│   │
│   ├── lib/
│   │   ├── api.ts                ← Cliente HTTP (fetch wrapper com interceptors)
│   │   ├── query-client.ts       ← Configuração global do TanStack Query
│   │   └── utils.ts              ← cn() (classnames) e utils gerais
│   │
│   ├── stores/
│   │   ├── auth.store.ts         ← Zustand: accessToken + dados do usuário
│   │   └── ui.store.ts           ← Zustand: modais, filtros, UI state
│   │
│   ├── queries/                  ← queryOptions do TanStack Query por domínio
│   │   ├── appointments.queries.ts
│   │   ├── services.queries.ts
│   │   └── availability.queries.ts
│   │
│   ├── mutations/                ← useMutation hooks por domínio
│   │   ├── appointments.mutations.ts
│   │   └── auth.mutations.ts
│   │
│   ├── components/
│   │   ├── ui/                   ← Componentes base (shadcn/ui)
│   │   │   ├── button.tsx
│   │   │   ├── input.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── calendar.tsx
│   │   │   ├── form.tsx
│   │   │   ├── toast.tsx
│   │   │   └── ...
│   │   └── features/             ← Componentes de domínio
│   │       ├── booking/
│   │       │   ├── BookingWizard.tsx
│   │       │   ├── ServiceSelector.tsx
│   │       │   ├── DatePicker.tsx
│   │       │   ├── TimeSlotPicker.tsx
│   │       │   └── BookingForm.tsx
│   │       └── dashboard/
│   │           ├── AppointmentCard.tsx
│   │           ├── AppointmentList.tsx
│   │           └── StatsOverview.tsx
│   │
│   ├── routes/                   ← Arquivos de rota do TanStack Router
│   │   ├── __root.tsx            ← Layout raiz
│   │   ├── index.tsx             ← Rota /
│   │   ├── _auth/                ← Rotas de autenticação (não protegidas)
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   ├── _dashboard/           ← Layout do dashboard (protegido)
│   │   │   ├── route.tsx         ← beforeLoad: verifica autenticação
│   │   │   ├── index.tsx         ← /dashboard
│   │   │   ├── appointments.tsx  ← /dashboard/appointments
│   │   │   ├── services.tsx      ← /dashboard/services
│   │   │   └── availability.tsx  ← /dashboard/availability
│   │   └── $tenantSlug/          ← Página pública de booking
│   │       └── index.tsx         ← /:tenantSlug
│   │
│   └── styles/
│       └── globals.css           ← Tailwind + tokens de design
│
├── vite.config.ts
├── tailwind.config.ts
└── package.json
```

---

## 3. TanStack Router — Configuração e Rotas

```typescript
// apps/web/src/router.tsx
import {
  createRouter,
  createRootRoute,
  createRoute,
} from "@tanstack/react-router";
import { RootLayout } from "./routes/__root";
import { IndexPage } from "./routes/index";
import { LoginPage } from "./routes/_auth/login";
import { RegisterPage } from "./routes/_auth/register";
import { DashboardLayout } from "./routes/_dashboard/route";
import { DashboardPage } from "./routes/_dashboard/index";
import { AppointmentsPage } from "./routes/_dashboard/appointments";
import { BookingPage } from "./routes/$tenantSlug/index";

const rootRoute = createRootRoute({ component: RootLayout });

// Rotas públicas
const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: IndexPage,
});
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: LoginPage,
});
const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/register",
  component: RegisterPage,
});
const bookingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$tenantSlug",
  component: BookingPage,
});

// Layout do dashboard — protegido por beforeLoad
const dashboardLayout = createRoute({
  getParentRoute: () => rootRoute,
  id: "_dashboard",
  component: DashboardLayout,
  beforeLoad: ({ context }) => {
    // Redireciona para /login se não autenticado
    if (!context.auth.isAuthenticated) {
      throw redirect({ to: "/login" });
    }
  },
});

const dashboardIndex = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/dashboard",
  component: DashboardPage,
});
const appointmentsRoute = createRoute({
  getParentRoute: () => dashboardLayout,
  path: "/dashboard/appointments",
  component: AppointmentsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  bookingRoute,
  dashboardLayout.addChildren([dashboardIndex, appointmentsRoute]),
]);

export const router = createRouter({
  routeTree,
  context: { auth: undefined! }, // Preenchido pelo AuthProvider
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
```

---

## 4. Autenticação — Zustand Store + Interceptor

```typescript
// apps/web/src/stores/auth.store.ts
import { create } from "zustand";

interface AuthState {
  accessToken: string | null;
  tenant: {
    id: string;
    name: string;
    email: string;
    slug: string;
    avatarUrl: string | null;
  } | null;
  isAuthenticated: boolean;
  setAuth: (token: string, tenant: AuthState["tenant"]) => void;
  clearAuth: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  tenant: null,
  isAuthenticated: false,

  setAuth: (accessToken, tenant) =>
    set({ accessToken, tenant, isAuthenticated: true }),

  clearAuth: () =>
    set({ accessToken: null, tenant: null, isAuthenticated: false }),
}));
```

```typescript
// apps/web/src/lib/api.ts
import axios from "axios";
import { useAuthStore } from "../stores/auth.store";

export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true, // envia cookies (refresh token) automaticamente
});

// Injeta o Access Token em toda requisição
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Renovação silenciosa: se 401, tenta refresh e repete a requisição
let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (err: unknown) => void;
}> = [];

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const originalRequest = error.config;

    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const { data } = await api.post<{ accessToken: string }>("/auth/refresh");
      useAuthStore
        .getState()
        .setAuth(data.accessToken, useAuthStore.getState().tenant!);
      failedQueue.forEach(({ resolve }) => resolve(data.accessToken));
      originalRequest.headers.Authorization = `Bearer ${data.accessToken}`;
      return api(originalRequest);
    } catch {
      failedQueue.forEach(({ reject }) => reject(error));
      useAuthStore.getState().clearAuth();
      window.location.href = "/login";
      return Promise.reject(error);
    } finally {
      isRefreshing = false;
      failedQueue = [];
    }
  },
);
```

---

## 5. TanStack Query — Configuração

```typescript
// apps/web/src/lib/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 min
      gcTime: 1000 * 60 * 10, // 10 min
      retry: 2,
      refetchOnWindowFocus: true,
    },
    mutations: {
      onError: (error) => {
        // Handler global de erro para mutations não tratadas localmente
        console.error("Mutation error:", error);
      },
    },
  },
});
```

```typescript
// apps/web/src/queries/appointments.queries.ts
import { queryOptions } from "@tanstack/react-query";
import { api } from "../lib/api";

export const appointmentsQueryOptions = (params?: {
  cursor?: string;
  status?: string;
}) =>
  queryOptions({
    queryKey: ["appointments", params],
    queryFn: () => api.get("/appointments", { params }).then((r) => r.data),
    staleTime: 1000 * 30, // 30s — agendamentos mudam com frequência
  });

export const appointmentByIdQueryOptions = (id: string) =>
  queryOptions({
    queryKey: ["appointments", id],
    queryFn: () => api.get(`/appointments/${id}`).then((r) => r.data),
  });
```

---

## 6. Componente Raiz e Providers

```tsx
// apps/web/src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { Toaster } from "./components/ui/toast";
import { router } from "./router";
import { queryClient } from "./lib/query-client";
import { useAuthStore } from "./stores/auth.store";
import "./styles/globals.css";

function App() {
  const auth = useAuthStore();

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} context={{ auth }} />
      <Toaster />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

---

## 7. Tokens de Design (Tailwind CSS 4)

```css
/* apps/web/src/styles/globals.css */
@import "tailwindcss";

@layer base {
  :root {
    --color-primary: oklch(52% 0.19 250); /* Azul BookMe */
    --color-primary-hover: oklch(45% 0.19 250);
    --color-secondary: oklch(62% 0.16 175); /* Verde */
    --color-destructive: oklch(52% 0.22 25); /* Vermelho */
    --color-surface: oklch(98% 0.005 240); /* Fundo claro */
    --color-border: oklch(88% 0.01 240);
    --color-text: oklch(18% 0.01 240);
    --color-text-muted: oklch(55% 0.01 240);
    --radius-sm: 0.375rem;
    --radius-base: 0.5rem;
    --radius-lg: 0.75rem;
  }
}
```

---

## 8. Checklist de Implementação

### Fase 1 — Setup

- [ ] **#FE-01** Criar `apps/web` com Vite + React + TypeScript (`pnpm create vite`)
- [ ] **#FE-02** Instalar TanStack Router, TanStack Query, Zustand, Axios, Zod
- [ ] **#FE-03** Instalar shadcn/ui CLI e inicializar (`pnpm dlx shadcn@latest init`)
- [ ] **#FE-04** Configurar Tailwind CSS 4 com tokens de design em `globals.css`
- [ ] **#FE-05** Configurar `VITE_API_URL` no `.env.local`

### Fase 2 — Infraestrutura

- [ ] **#FE-06** Implementar `api.ts` com interceptors de auth e refresh silencioso
- [ ] **#FE-07** Implementar `auth.store.ts` e `ui.store.ts` com Zustand
- [ ] **#FE-08** Configurar `query-client.ts` com `defaultOptions`
- [ ] **#FE-09** Configurar `router.tsx` com todas as rotas e `beforeLoad` de proteção

### Fase 3 — Validação

- [ ] **#FE-10** Verificar que acessar `/dashboard` sem login redireciona para `/login`
- [ ] **#FE-11** Verificar que após login, o Access Token está em memória (não no localStorage)
- [ ] **#FE-12** Verificar que ao expirar o token, a renovação silenciosa acontece sem logout

---

## 9. Referências

- ADR-006: TanStack Router → `docs/adr/0006-tanstack-router.md`
- ADR-012: State Management → `docs/adr/0012-state-management.md`
- ADR-015: UI System → `docs/adr/0015-ui-system.md`
- Spec 03: Endpoints de auth → `docs/specs/03-authentication-module.md`
