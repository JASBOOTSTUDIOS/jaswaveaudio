import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

const ADMIN_EMAIL = 'jaswave.audio@gmail.com';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Error: DATABASE_URL no está definida en el entorno.');
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log(`Configurando Super Administrador: ${ADMIN_EMAIL}...`);

  // 1. Crear o actualizar el usuario admin
  const usuario = await prisma.usuario.upsert({
    where: { email: ADMIN_EMAIL },
    update: { esAdmin: true },
    create: {
      email: ADMIN_EMAIL,
      esAdmin: true,
    },
  });

  console.log(`✓ Usuario admin registrado en BD: ID ${usuario.id} (esAdmin: ${usuario.esAdmin})`);

  // 2. Sembrar los 7 plugins oficiales si no existen
  const productos = [
    { id: 'com.jaswave.plugin.param-eq', nombre: 'JasWave Parametric EQ' },
    { id: 'com.jaswave.plugin.bus-compressor', nombre: 'JasWave Bus Compressor' },
    { id: 'com.jaswave.plugin.truepeak-limiter', nombre: 'JasWave True-Peak Limiter' },
    { id: 'com.jaswave.plugin.smart-deesser', nombre: 'JasWave Smart De-Esser' },
    { id: 'com.jaswave.plugin.utility-tool', nombre: 'JasWave Utility Tool' },
    { id: 'com.jaswave.plugin.piano-synth', nombre: 'JasWave Piano Synth' },
    { id: 'com.jaswave.plugin.roles-vst', nombre: 'JasWave Roles Synthesizer' },
  ];

  for (const p of productos) {
    await prisma.producto.upsert({
      where: { id: p.id },
      update: { nombre: p.nombre },
      create: { id: p.id, nombre: p.nombre },
    });

    // Otorgar licencia activa permanente al super admin para cada producto
    await prisma.licencia.upsert({
      where: { usuarioId_productoId: { usuarioId: usuario.id, productoId: p.id } },
      update: { estado: 'activa' },
      create: {
        usuarioId: usuario.id,
        productoId: p.id,
        estado: 'activa',
      },
    });
  }

  console.log(`✓ Los 7 plugins oficiales sembrados y licenciados para ${ADMIN_EMAIL}`);
  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('Error en seed-admin:', e);
  process.exit(1);
});
