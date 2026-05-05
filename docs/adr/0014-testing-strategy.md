# ADR-014 — Estratégia de Testes: Pirâmide com Vitest e React Testing Library

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Garantia de Qualidade (QA) e Estabilidade do Código

---

## Contexto

Sem uma estratégia de testes definida desde o início, os testes tendem a um dos dois extremos: nenhum teste (débito técnico acumulado), ou testes que testam detalhes de implementação (frágeis, quebram em qualquer refatoração interna). O projeto precisa de uma pirâmide de testes clara: o que testar em cada camada, quais ferramentas usar e quais são os critérios de cobertura mínima.

## Decisão

A Pirâmide de Testes do **BookMe**:

```text
         /------\
        /  E2E   \       ← Poucos (fluxos críticos completos)
       /----------\
      / Integração \     ← Moderados (repositories, workers, API handlers)
     /--------------\
    /   Unitários    \   ← Muitos (schemas, utils, lógica pura)
   /------------------\
```

### Camada 1 — Testes Unitários (Vitest)
**O que testar:**
- Schemas Zod: casos de borda, valores inválidos, transformações.
- Funções utilitárias: cálculo de slots, formatação de datas, lógica de negócio pura.
- Factories: instanciação correta de providers.
- Domain events: validação do payload gerado pelos eventos.

**O que NÃO testar nesta camada:**
- Banco de dados ou chamadas HTTP reais.
- Componentes React.

### Camada 2 — Testes de Integração (Vitest + Banco de Teste)
**O que testar:**
- **Repositories**: queries reais contra PostgreSQL (Docker), verificando isolamento por `tenant_id` (RLS).
- **Workers BullMQ**: processar jobs e verificar se as chamadas de infraestrutura (notificação) foram feitas.
- **API handlers**: requisições completas com `fastify.inject()`, verificando contrato (RFC 7807) e status codes.

### Camada 3 — Testes de Componente/Comportamento (Vitest + RTL)
**Filosofia central**: Testar o que o usuário vê e faz, nunca detalhes internos.

```typescript
// ✅ Correto — testa comportamento visível
test('exibe erro quando email é inválido', async () => {
  render(<LoginForm />);
  await userEvent.type(screen.getByLabelText('E-mail'), 'nao-e-um-email');
  await userEvent.click(screen.getByRole('button', { name: 'Entrar' }));
  expect(screen.getByText('E-mail inválido')).toBeInTheDocument();
});

// ❌ Errado — testa implementação interna (frágil)
test('setState é chamado com false após submit', () => { ... });
```

## Ferramentas de Suporte

| Ferramenta | Uso |
| :--- | :--- |
| **Vitest** | Runner de testes ultrarrápido compatível com Vite. |
| **user-event** | Simula interações reais do usuário de forma assíncrona. |
| **MSW (Mock Service Worker)** | Intercepta chamadas HTTP no nível da rede para testes de UI. |
| **Faker.js** | Geração de dados de teste realistas (nomes, e-mails, UUIDs). |
| **Docker Compose** | Perfil de teste com PostgreSQL e Redis isolados. |

## Cobertura Mínima Esperada

- **Schemas Zod**: 100% (são a fonte da verdade).
- **Repositories**: 80% de cobertura de branches.
- **Fluxos Críticos (Público)**: 100% do "caminho feliz" + principais cenários de erro.

## Consequências

- **Velocidade**: Vitest é significativamente mais rápido que o Jest para projetos TypeScript.
- **Realismo**: O MSW permite testar o comportamento real da UI (loading, error) sem mockar o `useQuery`.
- **Segurança**: Testar contra o banco real detecta falhas de RLS que mocks esconderiam.
- **Resiliência**: A separação entre camadas evita o anti-pattern de "testes que só passam no CI".