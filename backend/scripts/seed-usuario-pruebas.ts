import { PrismaClient } from '../src/generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

/**
 * Crea (o actualiza) un usuario normal —no admin— para pruebas de extremo a extremo en un Supabase LOCAL:
 * cuenta en Supabase Auth con el email confirmado, fila `Usuario`, licencia activa de todos los productos
 * y concesión `allow` para todas las acciones del asistente IA (ia.usar, ia.proveedor.*…).
 *
 * Variables: DATABASE_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, PRUEBAS_EMAIL, PRUEBAS_PASSWORD.
 * Se niega a ejecutarse contra un Supabase que no sea localhost.
 */
const PRODUCTO_IA = 'com.jaswave.modulo.asistente-ia';

function requerida(nombre: string): string {
  const v = process.env[nombre];
  if (!v) {
    console.error(`Error: ${nombre} no está definida en el entorno.`);
    process.exit(1);
  }
  return v;
}

async function asegurarCuentaAuth(supabaseUrl: string, claveServicio: string, email: string, password: string) {
  const cabeceras = { apikey: claveServicio, Authorization: `Bearer ${claveServicio}`, 'Content-Type': 'application/json' };
  const crear = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: cabeceras,
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  if (crear.ok) return ((await crear.json()) as { id: string }).id;
  // Ya existe: se busca y se le restablece la contraseña para que las pruebas sean repetibles.
  const lista = await fetch(`${supabaseUrl}/auth/v1/admin/users?per_page=1000`, { headers: cabeceras });
  const { users } = (await lista.json()) as { users: Array<{ id: string; email?: string }> };
  const existente = users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!existente) throw new Error(`no se pudo crear la cuenta Auth (${crear.status}): ${await crear.text()}`);
  const act = await fetch(`${supabaseUrl}/auth/v1/admin/users/${existente.id}`, {
    method: 'PUT',
    headers: cabeceras,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!act.ok) throw new Error(`no se pudo actualizar la cuenta Auth (${act.status})`);
  return existente.id;
}

async function main() {
  const url = requerida('DATABASE_URL');
  const supabaseUrl = requerida('SUPABASE_URL').replace(/\/$/, '');
  const claveServicio = requerida('SUPABASE_SERVICE_ROLE_KEY');
  const email = requerida('PRUEBAS_EMAIL');
  const password = requerida('PRUEBAS_PASSWORD');
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(supabaseUrl)) {
    console.error('Error: este script solo se ejecuta contra un Supabase local (127.0.0.1 o localhost).');
    process.exit(1);
  }

  const subAuth = await asegurarCuentaAuth(supabaseUrl, claveServicio, email, password);
  console.log(`✓ Cuenta Auth lista para ${email}`);

  const pool = new pg.Pool({ connectionString: url });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  const usuario = await prisma.usuario.upsert({
    where: { email },
    update: { subAuth, esAdmin: false },
    create: { email, subAuth, esAdmin: false },
  });

  const productos = await prisma.producto.findMany({ select: { id: true } });
  for (const p of productos) {
    await prisma.licencia.upsert({
      where: { usuarioId_productoId: { usuarioId: usuario.id, productoId: p.id } },
      update: { estado: 'activa' },
      create: { usuarioId: usuario.id, productoId: p.id, estado: 'activa' },
    });
  }
  console.log(`✓ ${productos.length} licencias activas`);

  const acciones = await prisma.accion.findMany({ where: { productoId: PRODUCTO_IA } });
  for (const a of acciones) {
    await prisma.concesion.upsert({
      where: { usuarioId_accionId: { usuarioId: usuario.id, accionId: a.id } },
      update: { efecto: 'allow', expiraEn: null },
      create: { usuarioId: usuario.id, productoId: PRODUCTO_IA, accionId: a.id, efecto: 'allow' },
    });
  }
  console.log(`✓ Concesiones del asistente: ${acciones.map((a) => a.clave).join(', ') || '(ninguna acción definida)'}`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((e) => {
  console.error('Error en seed-usuario-pruebas:', e);
  process.exit(1);
});
