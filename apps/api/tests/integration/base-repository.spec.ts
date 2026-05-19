import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest'
import { db } from '../../src/infra/database/client'
import { tenants, services, NewService } from '../../src/infra/database/schema'
import { BaseRepository } from '../../src/infra/database/base.repository'
import { eq, sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import * as schema from '../../src/infra/database/schema'
import path from 'path'

class ServiceRepository extends BaseRepository<typeof services> {
  constructor(dbClient: any, tenantId: string) {
    super(dbClient, services, tenantId)
  }

  async findAll(tx?: any) {
    if (!tx) {
      return this.db.transaction(async (innerTx) => {
        await this.setSessionTenantId(innerTx)
        return this.baseQuery(innerTx).execute()
      })
    }
    await this.setSessionTenantId(tx)
    return this.baseQuery(tx).execute()
  }

  async create(data: Omit<NewService, 'tenantId'>, tx?: any) {
    const payload = this.withTenantId(data)
    if (!tx) {
      return this.db.transaction(async (innerTx) => {
        await this.setSessionTenantId(innerTx)
        return innerTx.insert(services).values(payload).returning().execute()
      })
    }
    await this.setSessionTenantId(tx)
    return tx.insert(services).values(payload).returning().execute()
  }

  async update(id: string, data: Partial<NewService>, tx: any) {
    await this.setSessionTenantId(tx)
    return tx
      .update(services)
      .set(data)
      .where(eq(services.id, id))
      .returning()
      .execute()
  }
}

describe('BaseRepository Integration Tests (Multi-Tenant Isolation)', () => {
  const tenantA = {
    id: '00000000-0000-0000-0000-000000000091',
    name: 'Tenant A - Test',
    email: 'tenant_a@test.com',
    passwordHash: 'dummy_hash',
    slug: 'tenant-a-test',
  }

  const tenantB = {
    id: '00000000-0000-0000-0000-000000000092',
    name: 'Tenant B - Test',
    email: 'tenant_b@test.com',
    passwordHash: 'dummy_hash',
    slug: 'tenant-b-test',
  }

  let testDb: typeof db
  let testPool: Pool

  beforeAll(async () => {
    // 1. Limpa completamente o banco de teste usando o superusuário para forçar a execução limpa de migrations
    console.log('Recreating test database schema...')
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`)
    await db.execute(sql`CREATE SCHEMA public`)
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`)

    // 2. Executa as migrations do zero
    console.log('Running test migrations...')
    await migrate(db, {
      migrationsFolder: path.resolve(__dirname, '../../src/infra/database/migrations'),
    })

    // 3. Cria um usuário do banco não-superusuário para testar a RLS
    // (PostgreSQL ignora RLS para superusuários/table owners, exigindo um papel padrão para validação)
    console.log('Setting up non-superuser database role for RLS validation...')
    try {
      await db.execute(sql`CREATE ROLE bookme_test_user WITH LOGIN PASSWORD 'bookme_test_pass'`)
    } catch (e) {
      // Ignora se o usuário já existe
    }

    // Garante acesso total do usuário de teste às tabelas criadas pelas migrations
    await db.execute(sql`GRANT USAGE ON SCHEMA public TO bookme_test_user`)
    await db.execute(sql`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bookme_test_user`)
    await db.execute(sql`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bookme_test_user`)

    // 4. Cria a conexão de testes secundária usando as credenciais do usuário restrito RLS
    const dbUrl = new URL(process.env.DATABASE_URL!)
    dbUrl.username = 'bookme_test_user'
    dbUrl.password = 'bookme_test_pass'

    testPool = new Pool({
      connectionString: dbUrl.toString(),
      max: 10,
      idleTimeoutMillis: 30000,
    })
    testDb = drizzle(testPool, { schema })

    // 5. Insere os Tenants de teste usando o cliente master
    console.log('Setting up test tenants...')
    await db
      .insert(tenants)
      .values([tenantA, tenantB])
      .onConflictDoNothing()
  })

  beforeEach(async () => {
    // Limpa a tabela de serviços antes de cada teste usando o cliente master
    await db.execute(sql`TRUNCATE TABLE services RESTART IDENTITY CASCADE`)
  })

  afterAll(async () => {
    // Encerra a conexão secundária restrita
    if (testPool) {
      await testPool.end()
    }

    // Remove os tenants de teste do banco usando o cliente master
    console.log('Cleaning up test tenants...')
    await db
      .delete(tenants)
      .where(sql`id IN (${tenantA.id}, ${tenantB.id})`)
  })

  // ── Cenário 1: Isolamento de leitura ───────────────────────────────────────
  it('should not return data from another tenant', async () => {
    const repoA = new ServiceRepository(testDb, tenantA.id)
    const repoB = new ServiceRepository(testDb, tenantB.id)

    // Insere serviços em cada tenant diretamente via cliente master
    await db.insert(services).values([
      {
        id: '00000000-0000-0000-0000-000000000093',
        tenantId: tenantA.id,
        name: 'Corte Tenant A',
        durationMinutes: 30,
        priceCents: 4000,
      },
      {
        id: '00000000-0000-0000-0000-000000000094',
        tenantId: tenantB.id,
        name: 'Corte Tenant B',
        durationMinutes: 40,
        priceCents: 5000,
      },
    ])

    const servicesA = await repoA.findAll()
    const servicesB = await repoB.findAll()

    // Valida que cada repositório só vê os seus próprios serviços
    expect(servicesA.length).toBe(1)
    expect(servicesA[0].name).toBe('Corte Tenant A')

    expect(servicesB.length).toBe(1)
    expect(servicesB[0].name).toBe('Corte Tenant B')

    // Nenhum service do tenant B aparece no resultado do tenant A
    const idsA = servicesA.map((s) => s.id)
    const idsB = servicesB.map((s) => s.id)
    expect(idsA).not.toEqual(expect.arrayContaining(idsB))
  })

  // ── Cenário 2: Isolamento de escrita (insert injeta tenantId) ──────────────
  it('should inject tenantId automatically on insertion', async () => {
    const repoA = new ServiceRepository(testDb, tenantA.id)

    // Insere sem informar tenantId no payload
    const [insertedService] = await repoA.create({
      id: '00000000-0000-0000-0000-000000000095',
      name: 'Corte Injetado',
      durationMinutes: 30,
      priceCents: 4500,
    })

    // Valida que o tenantId foi preenchido automaticamente com o ID do repositório
    expect(insertedService).toBeDefined()
    expect(insertedService.tenantId).toBe(tenantA.id)
    expect(insertedService.name).toBe('Corte Injetado')
  })

  // ── Cenário 3: Proteção RLS (bypass direto ao banco) ──────────────────────
  it('should return 0 results when querying direct DB bypass without tenant session context', async () => {
    // Insere um serviço associado ao tenant A
    await db.insert(services).values({
      id: '00000000-0000-0000-0000-000000000096',
      tenantId: tenantA.id,
      name: 'Corte RLS Protection',
      durationMinutes: 30,
      priceCents: 4000,
    })

    // Executa query direta via cliente restrito sem configurar a variável de sessão (bypass)
    // O RLS deve filtrar e retornar 0 registros, mesmo que a tabela contenha dados
    const directResult = await testDb.select().from(services)
    expect(directResult.length).toBe(0)
  })

  // ── Cenário 4: Isolamento de update ────────────────────────────────────────
  it('should not update records belonging to another tenant and return 0 rows affected', async () => {
    const repoA = new ServiceRepository(testDb, tenantA.id)

    // Insere serviço do tenant B
    const [serviceB] = await db
      .insert(services)
      .values({
        id: '00000000-0000-0000-0000-000000000097',
        tenantId: tenantB.id,
        name: 'Corte Original Tenant B',
        durationMinutes: 30,
        priceCents: 4000,
      })
      .returning()

    // Tenta atualizar o registro do tenant B usando a instância do repositório do tenant A (via cliente restrito)
    // Deve rodar em transação para simular o RLS com a variável de sessão
    const updateResult = await testDb.transaction(async (tx) => {
      return repoA.update(serviceB.id, { name: 'Hack Name' }, tx)
    })

    // Garante que nenhum registro foi alterado (retorna array vazio / 0 rows affected)
    expect(updateResult.length).toBe(0)

    // Confirma no banco (com contexto restrito de B) que o nome do serviço do tenant B NÃO foi modificado
    const [finalServiceB] = await testDb.transaction(async (tx) => {
      // Usa setSessionTenantId do tenant B para conseguir ler a linha original
      await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tenantB.id}, true)`)
      return tx.select().from(services).where(eq(services.id, serviceB.id))
    })

    expect(finalServiceB.name).toBe('Corte Original Tenant B')
  })
})
