# ADR-010 — Estratégia de Notificações: Providers, Canais e Fallback

**Status:** Aceito  
**Data:** A definir  
**Contexto:** Comunicação com o Cliente e Engagement

---

## Contexto

O sistema precisa enviar notificações em múltiplos momentos: confirmação de agendamento, lembrete 24h antes, lembrete 1h antes, confirmação de cancelamento. Os canais possíveis são e-mail, SMS e WhatsApp. A decisão sobre quais providers utilizar e como estruturar a camada de notificação impacta tanto o custo quanto a implementação do *Factory Method*.

No contexto brasileiro, o WhatsApp tem taxa de abertura significativamente superior ao e-mail e ao SMS, tornando-o o canal primário mais eficaz para garantir que o cliente não falte ao agendamento.

## Opções consideradas por canal

### E-mail
| Provider | Plano gratuito | SDK TypeScript | Observação |
| :--- | :--- | :--- | :--- |
| **Resend** | 3.000 e-mails/mês | Nativo, excelente DX | Moderno, feito para devs, React Email integrado |
| **SendGrid** | 100 e-mails/dia | Oficial | Maduro, mais corporativo |
| **AWS SES** | Pago por uso | Via AWS SDK | Mais barato em escala, porém mais complexo de configurar |

### WhatsApp / SMS
| Provider | Tipo | Risco | Observação |
| :--- | :--- | :--- | :--- |
| **Evolution API / Z-API** | API não oficial | Alto (ban da conta) | Viável para MVP/dev, arriscado para produção |
| **WhatsApp Business API (Meta)** | API oficial | Baixo | Custo por mensagem, aprovação de templates necessária |
| **Twilio** | SMS + WhatsApp oficial | Baixo | Unifica SMS e WhatsApp, excelente confiabilidade |

## Decisão

1.  **Canal primário**: E-mail via **Resend** para todas as notificações do MVP. Escolhido pela API *TypeScript-first*, integração nativa com **React Email** (templates em JSX), e plano gratuito generoso.
2.  **Canal secundário (v2)**: WhatsApp via **Twilio** usando a API oficial do WhatsApp Business para evitar riscos de banimento.
3.  **Ambiente de Testes**: Uso de um `MockNotificationProvider` que intercepta e apenas loga as mensagens no console.

### Implementação (Factory Method)

```typescript
// Interface contratual — todos os providers implementam isso
interface NotificationProvider {
  send(payload: NotificationPayload): Promise<NotificationResult>;
}

type NotificationPayload = {
  to: string;
  template: 'booking-confirmed' | 'reminder-24h' | 'reminder-1h' | 'booking-cancelled';
  data: Record<string, unknown>;
};

// Factory — decisão de qual provider usar centralizada aqui
class NotificationFactory {
  static create(channel: 'email' | 'whatsapp'): NotificationProvider {
    if (process.env.NODE_ENV === 'test') return new MockNotificationProvider();
    
    if (channel === 'email') return new ResendEmailProvider();
    if (channel === 'whatsapp') return new TwilioWhatsAppProvider();
    
    throw new Error(`Canal de notificação desconhecido: ${channel}`);
  }
}
```

**Estratégia de Fallback**: Se o envio falhar após as retentativas do **BullMQ** (3 tentativas com backoff exponencial), o job vai para a *Dead Letter Queue (DLQ)* para auditoria e intervenção manual se necessário.

## Consequências

- O `MockNotificationProvider` garante que testes automatizados nunca gerem custos ou disparos reais.
- A adição de novos canais (ex: Telegram ou Push) requer apenas um novo provider e uma linha no Factory.
- Templates em **React Email** permitem manter a identidade visual de forma consistente e fácil de testar.
- Necessidade de planejar a aprovação de templates na Meta para o uso do WhatsApp Business em produção.
- O custo por mensagem do WhatsApp deve ser refletido no modelo de cobrança do SaaS para garantir a margem.