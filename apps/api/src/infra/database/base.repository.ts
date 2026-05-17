import { PgTableWithColumns } from 'drizzle-orm/pg-core'
import { eq, sql } from 'drizzle-orm'
import { DrizzleClient } from './client'

export abstract class BaseRepository<TTable extends PgTableWithColumns<any>> {
  constructor(
    protected readonly db: DrizzleClient,
    protected readonly table: TTable,
    protected readonly tenantId: string,
  ) {}

  /**
   * Executa a configuração da variável de sessão para o Row-Level Security (RLS).
   * Deve ser executado antes de qualquer operação no banco.
   * Utilizar SET LOCAL garante que o valor é limpo ao fim da transação.
   */
  protected async setSessionTenantId(
    tx: { execute: DrizzleClient['execute'] } = this.db
  ): Promise<void> {
    await tx.execute(
      sql`SET LOCAL app.current_tenant_id = ${this.tenantId}`
    )
  }

  /**
   * Retorna a query base com o filtro do tenantId ativo, aplicando a Camada 1 de isolamento.
   */
  protected baseQuery() {
    const tableWithTenant = this.table as unknown as { tenantId: TTable['tenantId'] }
    return this.db
      .select()
      .from(this.table as any)
      .where(eq(tableWithTenant.tenantId, this.tenantId))
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
