# ADR-012 — Gerenciamento de Estado: TanStack Query + Zustand (Separação por Responsabilidade)

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Desenvolvimento de Frontend e Gerenciamento de Dados

---

## Contexto

O frontend possui dois tipos fundamentalmente diferentes de estado, que requerem estratégias distintas de gerenciamento. Misturá-los numa única solução cria código difícil de manter, com múltiplas fontes de verdade e sincronização manual desnecessária.

- **Server state**: Dados que originam no servidor, que envelhecem (*stale*) e precisam ser ressincronizados: lista de agendamentos, disponibilidade do prestador, dados de perfil.
- **Client state**: Dados que existem apenas no browser e não precisam de persistência no servidor: modal aberto/fechado, etapa atual de um wizard, filtro selecionado na agenda.

## Decisão

Regra fundamental: se o dado vem de uma API ou será enviado para uma API, é responsabilidade do **TanStack Query**. Se é puramente estado de UI, é responsabilidade do **Zustand**.

Nunca duplicar *server state* no Zustand. Isso cria duas fontes de verdade e exige sincronização manual, que é exatamente o que o TanStack Query resolve.

### Domínios de responsabilidade:

| Estado | Ferramenta | Exemplos |
| :--- | :--- | :--- |
| **Dados do servidor** | TanStack Query | Agendamentos, serviços, disponibilidade, perfil |
| **Cache e revalidação** | TanStack Query | `staleTime`, `gcTime`, `invalidateQueries` |
| **Status da API** | TanStack Query | `isPending`, `isError`, `isSuccess` |
| **UI local transitória** | Zustand | Modal aberto, step do wizard, filtro da agenda |
| **Dados globais de sessão** | Zustand | Dados do usuário autenticado (derivado do token) |

### Configuração base do TanStack Query:

```typescript
// src/lib/query-client.ts
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:           1000 * 60 * 2,  // 2 min — dados considerados frescos
      gcTime:              1000 * 60 * 10, // 10 min — tempo para garbage collection
      retry:               2,
      refetchOnWindowFocus: true,           // revalida ao voltar para a aba
    },
  },
});
```

### Organização das queries (reuso):

```typescript
// src/queries/appointments.queries.ts
export const appointmentsQueryOptions = (prestadorId: string) =>
  queryOptions({
    queryKey: ['appointments', prestadorId],
    queryFn:  () => api.getAppointments(prestadorId),
    staleTime: 1000 * 60, // sobrescreve o padrão global para este recurso
  });
```

### Store Zustand para UI:

```typescript
// src/stores/ui.store.ts
interface UIStore {
  isNewAppointmentModalOpen: boolean;
  agendaFilter: 'today' | 'week' | 'month';
  openNewAppointmentModal: () => void;
  closeNewAppointmentModal: () => void;
  setAgendaFilter: (filter: UIStore['agendaFilter']) => void;
}
```

## Consequências

- Eliminação de `useEffect` para buscar dados — substituído por `useQuery`.
- *Loading* e *Error states* de API são gerenciados automaticamente, sem `useState` manual.
- Cache inteligente: navegar para outra rota e voltar não refaz a requisição se os dados ainda estão frescos.
- O Zustand mantém-se simples e síncrono, sem lógica de sincronização com o servidor.
- `invalidateQueries` após uma mutation garante que o servidor é consultado novamente de forma declarativa.