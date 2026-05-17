import { db } from '../client'
import { sql } from 'drizzle-orm'
import readline from 'readline'

async function askConfirmation(query: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close()
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
    })
  })
}

async function reset() {
  const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV

  if (!isDevelopment) {
    console.warn(`WARNING: You are running database reset in "${process.env.NODE_ENV || 'production'}" environment!`)
    const confirmed = await askConfirmation('Are you absolutely sure you want to truncate ALL tables? (y/n): ')
    
    if (!confirmed) {
      console.log('Database reset aborted by the user.')
      process.exit(0)
    }
  }

  console.log('Starting database reset...')

  try {
    await db.execute(sql`TRUNCATE TABLE appointment_audit_log RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE appointments RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_blocks RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE availability_schedules RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE services RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE tenant_settings RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE refresh_tokens RESTART IDENTITY CASCADE`)
    await db.execute(sql`TRUNCATE TABLE tenants RESTART IDENTITY CASCADE`)

    console.log('Database tables truncated and reset successfully!')
    process.exit(0)
  } catch (error) {
    console.error('Error during database reset:', error)
    process.exit(1)
  }
}

reset()
