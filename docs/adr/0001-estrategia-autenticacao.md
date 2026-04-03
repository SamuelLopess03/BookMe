# ADR-0001 — Estratégia de Autenticação: JWT + Refresh Token em Cookie HttpOnly

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Autenticação da API REST

---

## Contexto

O sistema precisa autenticar prestadores de serviço via API REST. A sessão precisa sobreviver ao fechamento do browser (lembrar usuário) mas também deve ser revogável de forma imediata (logout, troca de senha, suspensão de conta).

## Decisão

Usar **Access Token JWT** com expiração de 15 minutos, armazenado em memória no cliente (não em `localStorage`), combinado com **Refresh Token opaco** com expiração de 7 dias, armazenado em cookie `HttpOnly; Secure; SameSite=Strict`.

## Alternativas consideradas

| Opção                               | Vantagem                         | Desvantagem                          |
| ----------------------------------- | -------------------------------- | ------------------------------------ |
| JWT stateless (só access token)     | Sem estado no servidor           | Impossível revogar antes de expirar  |
| Sessions + Cookie (Redis)           | Revogação imediata               | Consulta ao Redis em toda requisição |
| **JWT + Refresh Token (escolhido)** | Equilíbrio segurança/performance | Ligeiramente mais complexo           |

## Consequências

- Access Token em memória: não acessível por XSS
- Refresh Token em HttpOnly: não roubável por XSS
- Revogação via invalidação do Refresh Token no banco (`refresh_tokens` table)
- Cliente implementa renovação automática antes do Access Token expirar
