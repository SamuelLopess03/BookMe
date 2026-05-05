# ADR-0006 — Frontend: TanStack Router para Roteamento

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Navegação e Roteamento Client-Side

---

## Contexto

O frontend do **BookMe** é uma Single Page Application (SPA). Precisamos de uma solução de roteamento que ofereça segurança de tipos (Type Safety) total, suporte a parâmetros de busca (Search Params) tipados e integração fluida com o ciclo de vida dos dados.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **React Router v6/v7** | Padrão de mercado; enorme ecossistema | Type safety limitada; exige ferramentas externas para tipar search params |
| **TanStack Router (escolhido)** | **100% Type-safe**; suporte nativo a Search Params; Route Loaders robustos | Curva de aprendizado inicial maior devido à tipagem rigorosa |
| **Wouter** | Minimalista e ultra leve | Sem suporte a loaders ou tipagem avançada de rotas |

## Decisão

Adotar o **TanStack Router** como gerenciador de rotas. A escolha justifica-se pela necessidade de eliminar erros de navegação em tempo de execução. Com o TanStack Router, URLs, parâmetros de rota e `search params` são tratados como código, não como strings.

**Recursos críticos utilizados:**
- **Route Loaders**: Para garantir que os dados necessários (ex: perfil do prestador) comecem a ser carregados antes mesmo do componente renderizar.
- **Search Params Validation**: Integração com Zod para validar e tipar filtros de busca na agenda (ex: `?date=2024-05-01`).

## Consequências

- **Robustez**: Navegar para uma rota inexistente ou passar parâmetros errados causará um erro de compilação, prevenindo links quebrados em produção.
- **DX Superior**: O desenvolvedor conta com auto-complete total ao criar links ou navegar programaticamente.
- **UX Otimizada**: Uso de `prefetch` automático ao fazer hover em links, reduzindo a percepção de latência para o usuário final.
