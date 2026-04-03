## Descrição

> Descreva de forma clara e objetiva **o que** foi feito e **por que**. Evite descrever o _como_ — o código faz isso.

---

## Issue relacionada

Closes #

---

## Tipo de mudança

- [ ] `feat` — Nova funcionalidade
- [ ] `fix` — Correção de bug
- [ ] `refactor` — Refatoração sem mudança de comportamento
- [ ] `test` — Adição ou correção de testes
- [ ] `docs` — Apenas documentação
- [ ] `chore` — Tarefa de manutenção (deps, configs, build)
- [ ] `ci` — Mudanças no pipeline de CI/CD
- [ ] `perf` — Melhoria de performance

---

## Checklist

### Código

- [ ] O código segue as convenções do projeto (nomenclatura, estrutura de módulos)
- [ ] Não há `console.log` ou código de debug esquecido
- [ ] Erros são tratados com a hierarquia correta (`AppError`, `NotFoundError`, etc.)
- [ ] Não há segredos ou credenciais no código

### Testes

- [ ] Testes unitários foram adicionados ou atualizados para os casos alterados
- [ ] Testes de integração foram adicionados ou atualizados quando aplicável
- [ ] `pnpm test` passa localmente sem erros

### Documentação

- [ ] A Wiki foi atualizada se houve mudança de comportamento, decisão de arquitetura ou novo endpoint
- [ ] Um ADR foi adicionado se uma decisão arquitetural significativa foi tomada
- [ ] O `.env.example` foi atualizado se novas variáveis de ambiente foram adicionadas

---

## Como testar manualmente

> Descreva os passos para verificar manualmente que a mudança funciona como esperado:

1.
2.
3.

---

## Screenshots (se aplicável)

> Adicione capturas de tela para mudanças de UI.
