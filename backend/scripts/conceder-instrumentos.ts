// Registra los instrumentos independientes de JasWave como productos y concede a un usuario ya registrado su
// licencia activa y todas sus funciones premium. Lee id, nombre y funciones de cada plugins/<id>/jaswave-plugin.json
// (una sola fuente de verdad). Idempotente. Uso (BD local de desarrollo):
//   npx tsx --env-file=.env scripts/conceder-instrumentos.ts <correo> [--todos]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const INSTRUMENTOS = ['grand-piano', 'worship-drums', 'electric-bass', 'electric-guitar', 'shimmer-pad', 'strings-section', 'ambient-atmos'];

type Manifiesto = { id: string; name: string; license?: { features?: Array<{ key: string; description?: string }> } };

function leerManifiestos(todos: boolean): Manifiesto[] {
  const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'plugins');
  // --todos: también los FX y demás plugins con manifiesto (la mezcla y el máster de la IA los usan).
  const slugs = todos
    ? fs
        .readdirSync(raiz)
        .filter((d) => d.startsWith('com.jaswave.plugin.') && fs.existsSync(path.join(raiz, d, 'jaswave-plugin.json')))
        .map((d) => d.slice('com.jaswave.plugin.'.length))
    : INSTRUMENTOS;
  return slugs.map((slug) => {
    const m = JSON.parse(fs.readFileSync(path.join(raiz, `com.jaswave.plugin.${slug}`, 'jaswave-plugin.json'), 'utf8')) as Manifiesto;
    if (m.id !== `com.jaswave.plugin.${slug}`) throw new Error(`Manifiesto inconsistente en ${slug}: id ${m.id}`);
    return m;
  });
}

async function main() {
  const todos = process.argv.includes('--todos');
  const email = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const url = process.env.DATABASE_URL;
  if (!url || !email) throw new Error('Uso: conceder-instrumentos.ts <correo> [--todos]  (y DATABASE_URL en el entorno)');
  const pool = new pg.Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    const usuario = await prisma.usuario.findUnique({ where: { email } });
    if (!usuario) throw new Error(`No existe el usuario ${email}: regístrate primero en la app`);
    for (const m of leerManifiestos(todos)) {
      await prisma.producto.upsert({ where: { id: m.id }, update: { nombre: m.name }, create: { id: m.id, nombre: m.name } });
      await prisma.licencia.upsert({
        where: { usuarioId_productoId: { usuarioId: usuario.id, productoId: m.id } },
        update: { estado: 'activa' },
        create: { usuarioId: usuario.id, productoId: m.id, estado: 'activa' },
      });
      const funciones = m.license?.features ?? [];
      for (const f of funciones) {
        const accion = await prisma.accion.upsert({
          where: { productoId_clave: { productoId: m.id, clave: f.key } },
          update: { descripcion: f.description ?? f.key },
          create: { productoId: m.id, clave: f.key, descripcion: f.description ?? f.key },
        });
        await prisma.concesion.upsert({
          where: { usuarioId_accionId: { usuarioId: usuario.id, accionId: accion.id } },
          update: { efecto: 'allow', expiraEn: null },
          create: { usuarioId: usuario.id, productoId: m.id, accionId: accion.id, efecto: 'allow' },
        });
      }
      console.log(`  ${m.name}: licencia activa + ${funciones.length} función(es) (${funciones.map((f) => f.key).join(', ')})`);
    }
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((e) => {
  console.error('ERROR', e instanceof Error ? e.message : e);
  process.exit(1);
});
