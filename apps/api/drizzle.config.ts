import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema:    './src/infra/database/schema/index.ts',
  out:       './src/infra/database/migrations',
  dialect:   'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose: true,
  strict:  true,
})
