// Temporal (no versionar): concede licencia activa de los 7 productos a un correo ya registrado.
import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const EMAIL = process.argv[2];
const PRODUCTOS = [
  'com.jaswave.plugin.param-eq', 'com.jaswave.plugin.bus-compressor', 'com.jaswave.plugin.truepeak-limiter',
  'com.jaswave.plugin.smart-deesser', 'com.jaswave.plugin.utility-tool', 'com.jaswave.plugin.piano-synth',
  'com.jaswave.plugin.roles-vst', 'com.jaswave.plugin.sampler',
];
const NOMBRES: Record<string, string> = {
  'com.jaswave.plugin.param-eq': 'JasWave Parametric EQ', 'com.jaswave.plugin.bus-compressor': 'JasWave Bus Compressor',
  'com.jaswave.plugin.truepeak-limiter': 'JasWave True-Peak Limiter', 'com.jaswave.plugin.smart-deesser': 'JasWave Smart De-Esser',
  'com.jaswave.plugin.utility-tool': 'JasWave Utility Tool', 'com.jaswave.plugin.piano-synth': 'JasWave Piano Synth',
  'com.jaswave.plugin.roles-vst': 'JasWave Roles Synthesizer', 'com.jaswave.plugin.sampler': 'JasWave Sampler',
};
const ACCIONES: Record<string, string[]> = {
  'com.jaswave.plugin.param-eq': ['eq.bandas-avanzadas', 'eq.pendientes-altas', 'eq.analizador'],
  'com.jaswave.plugin.bus-compressor': ['comp.filtro-sidechain', 'comp.mezcla-paralela'],
  'com.jaswave.plugin.truepeak-limiter': ['limitador.medicion-lufs', 'limitador.dither'],
  'com.jaswave.plugin.smart-deesser': ['deesser.escucha-sidechain', 'deesser.deteccion-relativa'],
  'com.jaswave.plugin.utility-tool': ['utilidad.mono-graves', 'utilidad.ancho-estereo'],
  'com.jaswave.plugin.piano-synth': ['piano.polifonia-extendida', 'piano.imagen-estereo'],
  'com.jaswave.plugin.roles-vst': ['roles.bateria', 'roles.efectos'],
  'com.jaswave.plugin.sampler': ['sampler.biblioteca'],
};
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !EMAIL) throw new Error('Falta DATABASE_URL o el correo');
  const pool = new pg.Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  const usuario = await prisma.usuario.findUnique({ where: { email: EMAIL } });
  if (!usuario) throw new Error(`No existe el usuario ${EMAIL}`);
  console.log(`usuario ${usuario.id} admin=${usuario.esAdmin}`);
  for (const id of PRODUCTOS) {
    await prisma.producto.upsert({ where: { id }, update: {}, create: { id, nombre: NOMBRES[id] ?? id } });
    await prisma.licencia.upsert({
      where: { usuarioId_productoId: { usuarioId: usuario.id, productoId: id } },
      update: { estado: 'activa' },
      create: { usuarioId: usuario.id, productoId: id, estado: 'activa' },
    });
    for (const clave of ACCIONES[id] ?? []) {
      const accion = await prisma.accion.upsert({
        where: { productoId_clave: { productoId: id, clave } },
        update: {},
        create: { productoId: id, clave, descripcion: clave },
      });
      await prisma.concesion.upsert({
        where: { usuarioId_accionId: { usuarioId: usuario.id, accionId: accion.id } },
        update: { efecto: 'allow', expiraEn: null },
        create: { usuarioId: usuario.id, productoId: id, accionId: accion.id, efecto: 'allow' },
      });
    }
    console.log(`  licencia activa + ${(ACCIONES[id] ?? []).length} acciones: ${id}`);
  }
  await prisma.$disconnect();
  await pool.end();
}
main().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
