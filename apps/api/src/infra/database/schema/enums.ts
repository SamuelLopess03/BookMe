import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Representa o ciclo de vida de um agendamento no sistema.
 */
export const appointmentStatusEnum = pgEnum("appointment_status", [
  /** Criado pelo cliente, aguarda ação do prestador */
  "pending",
  /** Prestador confirmou o agendamento */
  "confirmed",
  /** Prestador recusou o agendamento */
  "rejected",
  /** Cancelado por client, tenant ou system */
  "cancelled",
  /** Atendimento realizado (marcado manualmente ou por job agendado) */
  "completed",
]);

/**
 * Identifica quem iniciou o cancelamento de um agendamento.
 * Utilizado apenas quando o status é 'cancelled'.
 */
export const cancelledByEnum = pgEnum("cancelled_by", [
  /** Cliente cancelou via link do e-mail */
  "client",
  /** Prestador cancelou pelo dashboard */
  "tenant",
  /** Cancelamento automático pelo sistema (ex: prestador inativou o serviço) */
  "system",
]);

/**
 * Identifica o autor da mudança de status para fins de auditoria.
 */
export const changedByEnum = pgEnum("changed_by", [
  /** Mudança provocada pelo cliente */
  "client",
  /** Mudança provocada pelo prestador */
  "tenant",
  /** Mudança automática do sistema */
  "system",
]);

/**
 * Status de processamento para chaves de idempotência (ADR-016).
 */
export const idempotencyKeyStatusEnum = pgEnum("idempotency_key_status", [
  /** Requisição está sendo processada */
  "processing",
  /** Requisição finalizada com sucesso */
  "completed",
  /** Houve falha no processamento da requisição */
  "failed",
]);
