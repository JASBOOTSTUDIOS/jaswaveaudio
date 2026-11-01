import { execSync } from 'node:child_process';
import pg from 'pg';

/** URL de la base exclusiva de pruebas: nunca la de desarrollo, porque las pruebas la vacían. */
export const URL_BD_PRUEBAS =
  process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:55322/jaswave_test';

export default async function prepararBaseDePruebas(): Promise<void> {
  const url = new URL(URL_BD_PRUEBAS);
  const nombre = url.pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(nombre)) {
    throw new Error(`la base de pruebas debe terminar en _test (recibido: ${nombre})`);
  }
  const admin = new URL(URL_BD_PRUEBAS);
  admin.pathname = '/postgres';
  const cliente = new pg.Client({ connectionString: admin.toString() });
  await cliente.connect();
  const existe = await cliente.query('select 1 from pg_database where datname = $1', [nombre]);
  if (existe.rowCount === 0) await cliente.query(`create database "${nombre}"`);
  await cliente.end();
  execSync('npx prisma migrate deploy', {
    stdio: 'pipe',
    env: { ...process.env, DATABASE_URL: URL_BD_PRUEBAS },
  });
}
