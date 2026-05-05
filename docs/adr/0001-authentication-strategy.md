# ADR-0001 — Estratégia de Autenticação: JWT + Refresh Token

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Segurança e Autenticação da API REST

---

## Contexto

O sistema precisa autenticar prestadores de serviço via API REST. A sessão precisa sobreviver ao fechamento do browser (lembrar usuário) mas também deve ser revogável de forma imediata (logout, troca de senha, suspensão de conta).

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **JWT stateless (só access token)** | Sem estado no servidor | Impossível revogar antes de expirar |
| **Sessions + Cookie (Redis)** | Revogação imediata | Consulta ao Redis em toda requisição |
| **JWT + Refresh Token (escolhido)** | Equilíbrio segurança/performance | Ligeiramente mais complexo |

## Decisão

Utilizar a estratégia de **Split Token**:

1.  **Access Token JWT**: Expiração de 15 minutos, armazenado em **memória** no cliente (não em `localStorage`).
2.  **Refresh Token Opaco**: Expiração de 7 dias, armazenado em banco de dados (`refresh_tokens` table) e enviado ao cliente via **Cookie HttpOnly; Secure; SameSite=Strict**.

## Consequências

- **Segurança contra XSS**: O Access Token em memória e o Refresh Token em cookie `HttpOnly` tornam o roubo de sessão via scripts maliciosos extremamente difícil.
- **Segurança contra CSRF**: A flag `SameSite=Strict` protege o endpoint de refresh contra ataques de falsificação de requisição.
- **Revogabilidade**: O servidor pode invalidar sessões deletando o Refresh Token do banco de dados.
- **Performance**: A maioria das requisições são validadas de forma stateless via JWT.
