import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type Db = PrismaClient;

export function crearDb(urlBaseDatos?: string): Db {
  const connectionString = urlBaseDatos ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no configurado');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
