# ADR-016 — Idempotência nas Requisições de Criação (Idempotency Keys)

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Confiabilidade de Transações e Integridade de Dados

---

## Contexto

O formulário de agendamento público é a operação mais crítica do sistema. Em condições de rede instável ou comportamento do usuário (duplo clique, reenvio de formulário), a mesma requisição `POST /api/v1/agendamentos` pode chegar ao servidor mais de uma vez. Sem proteção de idempotência, cada requisição criaria um agendamento independente, resultando em duplicatas — o que prejudica severamente a confiabilidade do produto.

## Opções consideradas

| Opção | Mecanismo | Observação |
| :--- | :--- | :--- |
| **Disable do botão no frontend** | `disabled={mutation.isPending}` | Mitiga duplo clique, mas não protege contra problemas de rede ou retries automáticos. |
| **Unique constraint no banco** | `UNIQUE(prestador, cliente, data_hora)` | Incompleto: o mesmo cliente pode querer agendar dois serviços diferentes no mesmo horário. |
| **Idempotency Key no header** | UUID gerado no cliente e validado no servidor | **Proteção robusta**: o servidor reconhece requisições duplicadas e retorna o resultado original. |

## Decisão

Implementar **Idempotency Keys** no endpoint de criação de agendamentos:

### 1. No Frontend (Client)
A key é gerada quando o componente `BookingWizard` é montado (não no clique) e enviada via header:

```typescript
// src/components/features/appointments/BookingWizard.tsx
const idempotencyKey = useRef(crypto.randomUUID()); // Único por instância do wizard

// Na mutation:
mutationFn: (data) => api.createAppointment(data, {
  headers: { 'Idempotency-Key': idempotencyKey.current }
})
```

### 2. No Backend (Server)
O handler verifica a key antes de processar:
1.  **Check**: Busca na tabela `idempotency_keys` pelo par `{key, tenant_id}`.
    -   **Completed**: Retorna o resultado original salvo (HTTP 201).
    -   **Processing**: Retorna HTTP 409 (conflito/em andamento).
2.  **Process**: Insere com status `processing`, executa a lógica de negócio e, ao final, atualiza para `completed` salvando o corpo da resposta.

### Schema da Tabela:

```sql
CREATE TABLE idempotency_keys (
  key         UUID NOT NULL,
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  endpoint    VARCHAR(200) NOT NULL,
  status      VARCHAR(20) NOT NULL,      -- 'processing' | 'completed' | 'failed'
  response    JSONB,                     -- Response body para replay
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  expires_at  TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
  PRIMARY KEY (tenant_id, key)
);

CREATE INDEX ON idempotency_keys (expires_at) WHERE status = 'completed';
```

**Limpeza**: Um job diário no **BullMQ** remove chaves expiradas para evitar o crescimento infinito da tabela.

## Consequências

- **Resiliência**: Duplo clique, retry de rede e reenvio de formulário são neutralizados.
- **UX**: O cliente em conexão instável recebe a confirmação original em vez de um erro ou duplicata.
- **Escalabilidade**: O padrão pode ser estendido a qualquer endpoint de criação crítico.
- **Segurança**: Proteção em dupla camada somada ao *disable* do botão no frontend (ADR-013).
