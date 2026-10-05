import {defineConfig} from 'drizzle-kit'
export default defineConfig({
 dialect:'postgresql',schema:'./src/postgres/schema.ts',out:'./migrations/postgres',strict:true,
 ...(process.env.RUE_DATABASE_URL?{dbCredentials:{url:process.env.RUE_DATABASE_URL}}:{}),
})
