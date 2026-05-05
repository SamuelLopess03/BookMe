# ADR-011 — Schema Zod Compartilhado entre Frontend e Backend

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Integridade de Dados e Developer Experience (DX)

---

## Contexto

O projeto utiliza **Zod** no backend (validação de input no Fastify) e no frontend (validação de formulários via React Hook Form). Sem uma fonte única de verdade, as mesmas regras de validação são escritas duas vezes — e quando uma muda (ex.: tamanho mínimo de um campo, formato de telefone), a outra fica desatualizada silenciosamente. Isso cria uma classe de bugs onde o frontend aceita um valor que o backend rejeita, ou vice-versa.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **Schemas duplicados** | Nenhum setup adicional | Duas fontes de verdade; *drift* inevitável |
| **Schema só no backend** | Sem duplicação | UX degradada; toda validação é uma *round-trip* ao servidor |
| **Pasta `shared/schemas` importada por ambos** | Uma fonte de verdade | Requer disciplina de *import path* |
| **Monorepo formal (Turborepo/Nx)** | Mais robusto em escala | Overhead excessivo para o tamanho atual do projeto |

## Decisão

Criar uma pasta `src/shared/schemas/` dentro da estrutura do monólito, com schemas Zod exportados e importados tanto pelo backend quanto pelo frontend.

### Estrutura de arquivos sugerida:
```text
src/
  shared/
    schemas/
      index.ts                    ← re-exporta todos os schemas
      appointment.schema.ts       ← agendamento: criação, atualização
      provider.schema.ts          ← cadastro e edição do prestador
      service.schema.ts           ← serviços oferecidos
      availability.schema.ts      ← configuração de disponibilidade
      auth.schema.ts              ← login, registro, refresh
```

### Exemplo de uso compartilhado:

```typescript
// src/shared/schemas/appointment.schema.ts
import { z } from 'zod';

export const createAppointmentSchema = z.object({
  servicoId:    z.string().uuid('ID do serviço inválido'),
  prestadorId:  z.string().uuid('ID do prestador inválido'),
  clienteNome:  z.string().min(2, 'Nome deve ter ao menos 2 caracteres').max(100),
  clienteEmail: z.string().email('E-mail inválido'),
  clienteTelefone: z.string().regex(/^\+?[1-9]\d{10,14}$/, 'Telefone inválido'),
  dataHora:     z.string().datetime('Formato de data inválido'),
});

export type CreateAppointmentInput = z.infer<typeof createAppointmentSchema>;
```

**No backend (Fastify):**
```typescript
import { createAppointmentSchema } from '@/shared/schemas/appointment.schema';
// usado no handler para validação automática do request body
```

**No frontend (React Hook Form):**
```typescript
import { createAppointmentSchema, CreateAppointmentInput } from '@/shared/schemas/appointment.schema';
const form = useForm<CreateAppointmentInput>({ 
  resolver: zodResolver(createAppointmentSchema) 
});
```

## Consequências

- Qualquer alteração numa regra de validação propaga automaticamente para ambas as camadas.
- Os tipos TypeScript inferidos (`z.infer`) são idênticos em todo o projeto, eliminando divergências de tipo entre API e UI.
- Se o projeto crescer para um monorepo, a extração da pasta `shared/` para um pacote npm interno será trivial.
- **Restrição**: A pasta `shared/` deve conter **apenas** schemas e tipos — nenhuma lógica de negócio, dependência de banco de dados ou frameworks.