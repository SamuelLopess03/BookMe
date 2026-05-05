# ADR-0008 — Contrato da API REST: Formato de Erros e Versionamento

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Desenvolvimento de API e Contrato de Integração

---

## Contexto

Sem um contrato padronizado para respostas de erro, cada rota tende a retornar estruturas diferentes: `{ error: "..." }`, `{ message: "..." }`, `{ errors: [...] }`. O frontend se torna um labirinto de condicionais tentando interpretar o que cada endpoint retornou. Além disso, a ausência de uma estratégia de versionamento impede evoluir a API sem quebrar clientes existentes.

## Opções consideradas para formato de erros

| Opção | Referência | Observação |
| :--- | :--- | :--- |
| **Formato ad-hoc por rota** | — | Inconsistente, dificulta tratamento genérico no cliente |
| **`{ message, code }` simples** | Comum em projetos pequenos | Funcional mas sem padronização formal |
| **RFC 7807 — Problem Details for HTTP APIs** | IETF Standard | Formato oficial, extensível, com campo `type` como identificador semântico |

## Opções consideradas para versionamento

| Opção | Exemplo | Observação |
| :--- | :--- | :--- |
| **Versão no path** | `/api/v1/agendamentos` | Mais explícito, fácil de testar no browser |
| **Header `Accept`** | `Accept: application/vnd.bookme.v1+json` | Mais RESTful, porém mais complexo para consumir |
| **Sem versionamento** | `/api/agendamentos` | Sem estratégia de migração futura |

## Decisão

1.  **Formato de erros baseado em RFC 7807**, com campo adicional `traceId` para correlação com o OpenTelemetry:

```json
{
  "type": "https://bookme.com/errors/slot-unavailable",
  "title": "Horário indisponível",
  "status": 409,
  "detail": "O horário das 14h já foi reservado por outro cliente.",
  "instance": "/api/v1/agendamentos",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

Para erros de validação (**422 Unprocessable Entity**), o campo `errors` é adicionado:

```json
{
  "type": "https://bookme.com/errors/validation",
  "title": "Dados inválidos",
  "status": 422,
  "detail": "Um ou mais campos não passaram na validação.",
  "instance": "/api/v1/agendamentos",
  "traceId": "...",
  "errors": [
    { "field": "data", "message": "Data não pode ser no passado" },
    { "field": "servicoId", "message": "Serviço não encontrado" }
  ]
}
```

2.  **Versionamento via path**: todas as rotas prefixadas com `/api/v1/`. A v2 pode coexistir em `/api/v2/` sem remover a v1 antes de um período de deprecação comunicado.

## Consequências

- O frontend pode criar um único interceptor Axios/Fetch que trata todos os erros de forma consistente.
- O `traceId` permite que um erro reportado por um usuário seja rastreado diretamente no Grafana/Jaeger.
- O campo `type` é uma URL semântica — pode no futuro apontar para uma página de documentação do erro.
- O Fastify tem suporte nativo a `setErrorHandler` global, onde esse formato pode ser aplicado centralmente.
- Equipe deve manter uma lista de `type` de erros conhecidos para evitar duplicatas.