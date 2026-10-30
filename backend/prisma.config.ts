import { defineConfig, env } from 'prisma/config';

// Prisma 7 ya no carga .env por su cuenta: lo hacemos aquí si existe (en CI llega por entorno).
try {
  process.loadEnvFile('.env');
} catch {
  // sin .env: se usan las variables del entorno
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: env('DATABASE_URL') },
});
