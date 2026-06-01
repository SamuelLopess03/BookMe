import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { db } from "../../src/infra/database/client";
import { tenants, services, NewService } from "../../src/infra/database/schema";
import { BaseRepository } from "../../src/infra/database/base.repository";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "../../src/infra/database/schema";
import path from "path";

function getPostgresErrorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) {
    return undefined;
  }

  const maybeError = error as { cause?: unknown; code?: unknown };
  const cause = maybeError.cause as { code?: unknown } | undefined;

  if (typeof cause?.code === "string") {
    return cause.code;
  }

  if (typeof maybeError.code === "string") {
    return maybeError.code;
  }

  return undefined;
}

class ServiceRepository extends BaseRepository<typeof services> {
  constructor(dbClient: any, tenantId: string) {
    super(dbClient, services, tenantId);
  }

  async findAll(tx?: any) {
    if (!tx) {
      return this.db.transaction(async (innerTx) => {
        await this.setSessionTenantId(innerTx);
        return this.baseQuery(innerTx).execute();
      });
    }
    await this.setSessionTenantId(tx);
    return this.baseQuery(tx).execute();
  }

  async create(data: Omit<NewService, "tenantId">, tx?: any) {
    const payload = this.withTenantId(data);
    if (!tx) {
      return this.db.transaction(async (innerTx) => {
        await this.setSessionTenantId(innerTx);
        return innerTx.insert(services).values(payload).returning().execute();
      });
    }
    await this.setSessionTenantId(tx);
    return tx.insert(services).values(payload).returning().execute();
  }

  async update(id: string, data: Partial<NewService>, tx: any) {
    await this.setSessionTenantId(tx);
    return tx
      .update(services)
      .set(data)
      .where(eq(services.id, id))
      .returning()
      .execute();
  }
}

describe("BaseRepository Integration Tests (Multi-Tenant Isolation)", () => {
  const tenantA = {
    id: "00000000-0000-0000-0000-000000000091",
    name: "Tenant A - Test",
    email: "tenant_a@test.com",
    passwordHash: "dummy_hash",
    slug: "tenant-a-test",
  };

  const tenantB = {
    id: "00000000-0000-0000-0000-000000000092",
    name: "Tenant B - Test",
    email: "tenant_b@test.com",
    passwordHash: "dummy_hash",
    slug: "tenant-b-test",
  };

  let testDb: typeof db;
  let testPool: Pool;

  beforeAll(async () => {
    console.log("Recreating test database schema...");
    await db.execute(sql`DROP SCHEMA IF EXISTS public CASCADE`);
    await db.execute(sql`CREATE SCHEMA public`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);

    console.log("Running test migrations...");
    await migrate(db, {
      migrationsFolder: path.resolve(
        __dirname,
        "../../src/infra/database/migrations",
      ),
    });

    console.log("Setting up non-superuser database role for RLS validation...");
    try {
      await db.execute(
        sql`CREATE ROLE bookme_test_user WITH LOGIN PASSWORD 'bookme_test_pass'`,
      );
    } catch (error: unknown) {
      const pgErrorCode = getPostgresErrorCode(error);
      if (pgErrorCode === "42710") {
        // Role already exists, ignora.
        console.log("Role bookme_test_user already exists, continuing...");
      } else {
        console.error("Erro ao criar role de teste:", error);
        throw error;
      }
    }

    await db.execute(sql`GRANT USAGE ON SCHEMA public TO bookme_test_user`);
    await db.execute(
      sql`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO bookme_test_user`,
    );
    await db.execute(
      sql`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO bookme_test_user`,
    );

    const dbUrl = new URL(process.env.DATABASE_URL!);
    dbUrl.username = "bookme_test_user";
    dbUrl.password = "bookme_test_pass";

    testPool = new Pool({
      connectionString: dbUrl.toString(),
      max: 10,
      idleTimeoutMillis: 30000,
    });
    testDb = drizzle(testPool, { schema });

    console.log("Setting up test tenants...");
    await db.insert(tenants).values([tenantA, tenantB]).onConflictDoNothing();
  });

  beforeEach(async () => {
    await db.execute(sql`TRUNCATE TABLE services RESTART IDENTITY CASCADE`);
  });

  afterAll(async () => {
    if (testPool) {
      await testPool.end();
    }

    console.log("Cleaning up test tenants...");
    await db.delete(tenants).where(sql`id IN (${tenantA.id}, ${tenantB.id})`);
  });

  it("should not return data from another tenant", async () => {
    const repoA = new ServiceRepository(testDb, tenantA.id);
    const repoB = new ServiceRepository(testDb, tenantB.id);

    await db.insert(services).values([
      {
        id: "00000000-0000-0000-0000-000000000093",
        tenantId: tenantA.id,
        name: "Corte Tenant A",
        durationMinutes: 30,
        priceCents: 4000,
      },
      {
        id: "00000000-0000-0000-0000-000000000094",
        tenantId: tenantB.id,
        name: "Corte Tenant B",
        durationMinutes: 40,
        priceCents: 5000,
      },
    ]);

    const servicesA = await repoA.findAll();
    const servicesB = await repoB.findAll();

    expect(servicesA.length).toBe(1);
    expect(servicesA[0].name).toBe("Corte Tenant A");

    expect(servicesB.length).toBe(1);
    expect(servicesB[0].name).toBe("Corte Tenant B");

    const idsA = servicesA.map((s) => s.id);
    const idsB = servicesB.map((s) => s.id);
    expect(idsA).not.toEqual(expect.arrayContaining(idsB));
  });

  it("should inject tenantId automatically on insertion", async () => {
    const repoA = new ServiceRepository(testDb, tenantA.id);

    const [insertedService] = await repoA.create({
      id: "00000000-0000-0000-0000-000000000095",
      name: "Corte Injetado",
      durationMinutes: 30,
      priceCents: 4500,
    });

    expect(insertedService).toBeDefined();
    expect(insertedService.tenantId).toBe(tenantA.id);
    expect(insertedService.name).toBe("Corte Injetado");
  });

  it("should return 0 results when querying direct DB bypass without tenant session context", async () => {
    await db.insert(services).values({
      id: "00000000-0000-0000-0000-000000000096",
      tenantId: tenantA.id,
      name: "Corte RLS Protection",
      durationMinutes: 30,
      priceCents: 4000,
    });

    const directResult = await testDb.select().from(services);
    expect(directResult.length).toBe(0);
  });

  it("should not update records belonging to another tenant and return 0 rows affected", async () => {
    const repoA = new ServiceRepository(testDb, tenantA.id);

    const [serviceB] = await db
      .insert(services)
      .values({
        id: "00000000-0000-0000-0000-000000000097",
        tenantId: tenantB.id,
        name: "Corte Original Tenant B",
        durationMinutes: 30,
        priceCents: 4000,
      })
      .returning();

    const updateResult = await testDb.transaction(async (tx) => {
      return repoA.update(serviceB.id, { name: "Hack Name" }, tx);
    });

    expect(updateResult.length).toBe(0);

    const [finalServiceB] = await testDb.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT set_config('app.current_tenant_id', ${tenantB.id}, true)`,
      );
      return tx.select().from(services).where(eq(services.id, serviceB.id));
    });

    expect(finalServiceB.name).toBe("Corte Original Tenant B");
  });
});
