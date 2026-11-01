import { cargarConfiguracion } from '../src/config.js';
import { crearDb } from '../src/db.js';
import { crearServicioIA, TIPOS_PROVEEDOR } from '../src/ia/proveedores.js';
import { claveMaestraDesdeBase64 } from '../src/seguridad/cifrado.js';

// Migración única: pasa el proveedor configurado con IA_* en el .env (M1) a la base de datos (M2).
// Después pueden borrarse las variables IA_PROVEEDOR/IA_BASE_URL/IA_MODELO/IA_API_KEY/IA_MODELOS del .env.
const env = process.env;
const config = cargarConfiguracion();
if (!env.IA_PROVEEDOR || !env.IA_BASE_URL || !env.IA_MODELO) {
  console.log('No hay IA_PROVEEDOR / IA_BASE_URL / IA_MODELO en el entorno: nada que importar.');
  process.exit(0);
}
if (!(TIPOS_PROVEEDOR as readonly string[]).includes(env.IA_PROVEEDOR)) {
  console.error(`IA_PROVEEDOR no válido: ${env.IA_PROVEEDOR}`);
  process.exit(1);
}
const db = crearDb(config.urlBaseDatos);
const servicio = crearServicioIA({
  db,
  claveMaestra: config.claveMaestraIA ? claveMaestraDesdeBase64(config.claveMaestraIA) : null,
});
const slug = env.IA_SLUG || 'principal';
const existente = await db.proveedorIA.findUnique({ where: { slug } });
if (existente) {
  console.log(`Ya existe el proveedor «${slug}»: no se modifica.`);
} else {
  const modelos = (env.IA_MODELOS || env.IA_MODELO).split(',').map((m) => m.trim()).filter(Boolean);
  const p = await servicio.admin!.crear('importar-entorno', {
    slug,
    nombre: env.IA_NOMBRE || 'Proveedor principal',
    tipo: env.IA_PROVEEDOR,
    baseUrl: env.IA_BASE_URL,
    modelos,
    modeloPorDefecto: env.IA_MODELO,
    ...(env.IA_MAX_TOKENS ? { maxTokens: Number(env.IA_MAX_TOKENS) } : {}),
    ...(env.IA_PETICIONES_POR_MINUTO ? { peticionesPorMinuto: Number(env.IA_PETICIONES_POR_MINUTO) } : {}),
    ...(env.IA_HERRAMIENTAS ? { herramientas: env.IA_HERRAMIENTAS === 'true' } : {}),
    ...(env.IA_API_KEY ? { apiKey: env.IA_API_KEY } : {}),
  });
  console.log(`Proveedor «${p.slug}» importado. Asigna la acción ia.proveedor.${p.slug} (y ia.usar) a los roles que deban usarlo.`);
}
await db.$disconnect();
