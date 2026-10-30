import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export type Db = PrismaClient;

export function crearDb(urlBaseDatos?: string): Db {
  const connectionString = urlBaseDatos ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL no configurado');
  // Entre Windows y Docker (WSL2) el puente de red descarta las conexiones TCP quietas al cabo de ~1 min: el pool las
  // seguía usando y las primeras peticiones tras un rato inactivo devolvían 500 («Server has closed the connection»).
  // Se mantienen vivas con TCP keepalive y el pool las retira antes de que el puente las corte.
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString, keepAlive: true, keepAliveInitialDelayMillis: 10_000, idleTimeoutMillis: 30_000 }),
  });
}
