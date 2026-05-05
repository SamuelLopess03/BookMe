# ADR-013 — Estratégia de Formulários: React Hook Form + Zod + Mutations

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Desenvolvimento de Frontend e Experiência do Usuário (UX)

---

## Contexto

O **BookMe** possui ao menos 6 formulários críticos no fluxo principal: registro, login, disponibilidade, serviços, agendamento público e perfil. Sem um padrão definido, cada formulário é implementado de forma diferente, dificultando a manutenção e os testes.

O ponto mais crítico é a integração entre a validação *client-side* (Zod + RHF) e os erros de validação retornados pelo servidor (**422 Unprocessable Entity** do Fastify). Sem um padrão, os erros do servidor aparecem em locais inconsistentes ou são simplesmente ignorados.

## Decisão

Padrão obrigatório para todos os formulários do projeto:

### Estrutura de Integração

```typescript
// 1. Schema importado do shared (ADR-011)
import { createServiceSchema, CreateServiceInput } from '@/shared/schemas/service.schema';

// 2. Hook do formulário — sempre tipado com inferência do schema
const form = useForm<CreateServiceInput>({
  resolver:      zodResolver(createServiceSchema),
  defaultValues: { nome: '', duracao: 60, preco: 0 },
});

// 3. Mutation do TanStack Query
const mutation = useMutation({
  mutationFn: api.createService,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['services'] });
    toast.success('Serviço criado com sucesso!');
  },
  onError: (error: ApiError) => {
    // Mapeia erros 422 do servidor para campos do formulário (ADR-0008)
    if (error.status === 422 && error.errors) {
      error.errors.forEach(({ field, message }) => {
        form.setError(field as keyof CreateServiceInput, { message });
      });
    } else {
      toast.error(error.detail ?? 'Erro inesperado. Tente novamente.');
    }
  },
});

// 4. Submit handler — sempre via handleSubmit do RHF
const onSubmit = form.handleSubmit((data) => mutation.mutate(data));
```

### Comportamento do Botão de Submit

```typescript
<Button
  type="submit"
  onClick={onSubmit}
  disabled={mutation.isPending || !form.formState.isValid}
>
  {mutation.isPending ? <Spinner /> : 'Salvar'}
</Button>
```

### Regras do Padrão:

1.  **Schema Único**: O schema Zod deve vir sempre de `shared/schemas` (ADR-011).
2.  **Mapeamento de Erros**: Erros 422 do servidor **devem** ser mapeados para campos via `form.setError`.
3.  **Toasts para Erros Globais**: Erros inesperados (500, rede) são exibidos via `toast`.
4.  **Estado de Loading**: O botão de submit deve usar `mutation.isPending`.
5.  **Reset de Formulário**: `form.reset()` só é chamado no `onSuccess` em formulários de criação.

## Consequências

- Uniformidade completa no comportamento de todos os formulários do sistema.
- Melhoria significativa na UX: erros de servidor aparecem diretamente nos campos correspondentes.
- Redução de *boilerplate*: elimina a necessidade de `useState` manuais para loading e error.
- Tipagem *end-to-end* garantida: qualquer mudança no schema quebra o código em tempo de compilação.
- Facilidade em testes automatizados: os testes seguem um padrão fixo de interação e asserção.