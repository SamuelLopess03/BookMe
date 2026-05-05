# ADR-015 — Sistema de UI: Radix UI + Tailwind CSS 4 (shadcn/ui)

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Desenvolvimento de Frontend e Design System

---

## Contexto

O projeto utiliza **Radix UI** para comportamento e acessibilidade e **Tailwind CSS 4** para estilos. O Radix UI é *headless*: fornece a lógica de componentes complexos (Dialog, Select, Popover) com acessibilidade completa, mas sem estilo visual. Sem uma estratégia de integração, a interface corre o risco de se tornar inconsistente e o desenvolvimento de componentes básicos se tornaria lento e repetitivo.

## Opções consideradas

| Opção | Vantagem | Desvantagem |
| :--- | :--- | :--- |
| **Estilizar Radix do zero** | Controle total | Lento; reinventa a roda para cada componente básico |
| **Libs Prontas (MUI/Chakra)** | Pronto para uso | Dificulta customização profunda; conflita com Tailwind |
| **shadcn/ui (Base + Custom)** | Componentes Radix + Tailwind; código no projeto | Sem "lib" instalada — requer gestão do código dos componentes |

## Decisão

Adotar o **shadcn/ui** como base do sistema de UI. O shadcn/ui não é uma dependência npm, mas um conjunto de componentes copiados para `src/components/ui/`, tornando-se código do projeto.

### Estrutura de Componentes:

```text
src/
  components/
    ui/                        ← Componentes atômicos (shadcn/ui)
      button.tsx
      dialog.tsx
      calendar.tsx             ← Crítico para o fluxo de agendamento
      form.tsx                 ← Integração RHF + Zod
    features/                  ← Componentes de domínio (Negócio)
      appointments/
        BookingWizard.tsx
      availability/
        AvailabilityGrid.tsx
```

### Princípio de Camadas:

1.  **`components/ui/`**: Componentes atômicos, genéricos e sem conhecimento de negócio.
2.  **`components/features/`**: Compõem os componentes de UI com lógica de domínio (queries, mutations).
3.  **Páginas (Rotas)**: Compõem os componentes de features para formar a tela final.

### Tokens de Design (Tailwind CSS 4):

```css
/* src/styles/globals.css */
@layer base {
  :root {
    --color-primary:     oklch(55% 0.2 250);    /* Azul Premium */
    --color-secondary:   oklch(65% 0.15 180);   /* Verde */
    --color-destructive: oklch(55% 0.22 25);    /* Vermelho */
    --radius-base:       0.5rem;
  }
}
```

## Consequências

- **Acessibilidade**: Garantia de conformidade WCAG 2.1 AA nativa via Radix UI.
- **Manutenibilidade**: Os componentes `ui/` são código do projeto, permitindo ajustes finos sem depender de atualizações de terceiros.
- **Agilidade**: O uso do `Calendar` do shadcn/ui acelera drasticamente a implementação da tela de seleção de horários.
- **Estética Moderna**: O uso de `oklch` no Tailwind 4 permite um gerenciamento superior de cores e temas (dark mode).
- **Onboarding**: Facilita a entrada de novos devs ao separar claramente componentes "base" de componentes de "negócio".