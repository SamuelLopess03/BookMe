import { db } from '../client'
import { tenants, tenantSettings, services, availabilitySchedules } from '../schema'
import { SEED_TENANT, SEED_SETTINGS, SEED_SERVICES, SEED_SCHEDULES } from './seed-data'

async function seed() {
  console.log('Starting database seeding...')

  try {
    // 1. Inserir Tenant
    console.log('Inserting tenant...')
    await db
      .insert(tenants)
      .values(SEED_TENANT)
      .onConflictDoNothing()

    // 2. Inserir Tenant Settings
    console.log('Inserting tenant settings...')
    await db
      .insert(tenantSettings)
      .values(SEED_SETTINGS)
      .onConflictDoNothing()

    // 3. Inserir Serviços
    console.log('Inserting services...')
    await db
      .insert(services)
      .values(SEED_SERVICES)
      .onConflictDoNothing()

    // 4. Inserir Disponibilidades
    console.log('Inserting availability schedules...')
    await db
      .insert(availabilitySchedules)
      .values(SEED_SCHEDULES)
      .onConflictDoNothing()

    console.log('Database seeded successfully!')
    process.exit(0)
  } catch (error) {
    console.error('Error during database seeding:', error)
    process.exit(1)
  }
}

seed()