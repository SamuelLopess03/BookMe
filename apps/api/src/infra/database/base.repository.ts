import { AnyPgTable, PgColumn, PgTransaction } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { DrizzleClient } from './client'

export type QueryClient = DrizzleClient | PgTransaction<any, any, any>

export abstract class BaseRepository<TTable extends AnyPgTable & { tenantId: PgColumn }> {
  constructor(
    protected readonly db: DrizzleClient,
    protected readonly table: TTable,
    protected readonly tenantId: string,
  ) {}

  /**
   * Executa a configuração da variável de sessão para o Row-Level Security (RLS).
   * EXIGE um contexto transacional ativo (PgTransaction) para garantir que o SET LOCAL
   * funcione corretamente e impeça vazamentos de dados entre conexões do pool.
   */
  protected async setSessionTenantId(tx: PgTransaction<any, any, any>): Promise<void> {
    await tx.execute(
      sql`SET LOCAL app.current_tenant_id = ${this.tenantId}`
    )
  }

  /**
   * Retorna a query base com o filtro do tenantId ativo, aplicando a Camada 1 de isolamento.
   * Aceita um cliente de consulta (que pode ser uma transação ativa) para garantir consistência.
   */
  protected baseQuery(tx: QueryClient = this.db) {
    return tx
      .select()
      .from(this.table as AnyPgTable)
      .where(eq(this.table.tenantId, this.tenantId))
  }

  /**
   * Injeta o tenantId no objeto de dados fornecido para operações de insert/create.
   */
  protected withTenantId<T extends Record<string, unknown>>(data: T): T & { tenantId: string } {
    return {
      ...data,
      tenantId: this.tenantId,
    }
  }
}
