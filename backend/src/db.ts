import { PrismaClient } from '@prisma/client';

export type Db = PrismaClient;

export function crearDb(urlBaseDatos?: string): Db {
  return new PrismaClient(urlBaseDatos ? { datasourceUrl: urlBaseDatos } : undefined);
}
