import { cargarConfiguracion } from '../src/config.js';
import { crearDb } from '../src/db.js';
import { crearServicioIA } from '../src/ia/proveedores.js';
import { claveMaestraDesdeBase64 } from '../src/seguridad/cifrado.js';

// Desarrollo local: da de alta (o actualiza) el proveedor KiloCode de pruebas con la clave de
// IA_PRUEBAS_KILO_API_KEY (backend/.env). Equivale a hacerlo desde Admin → IA.
const clave = process.env.IA_PRUEBAS_KILO_API_KEY;
if (!clave) {
  console.error('Falta IA_PRUEBAS_KILO_API_KEY en backend/.env');
  process.exit(1);
}
const config = cargarConfiguracion();
const db = crearDb(config.urlBaseDatos);
const servicio = crearServicioIA({ db, claveMaestra: claveMaestraDesdeBase64(config.claveMaestraIA!) });
const modelos = (process.env.IA_PRUEBAS_MODELOS || 'cohere/north-mini-code:free,openrouter/free,nvidia/nemotron-3.5-lightning:free').split(',');
const existente = await db.proveedorIA.findUnique({ where: { slug: 'kilo-pruebas' } });
if (existente) {
  await servicio.admin!.actualizar('pruebas', existente.id, { modelos, activo: true });
  await servicio.admin!.fijarClave('pruebas', existente.id, clave);
  console.log('Proveedor kilo-pruebas actualizado.');
} else {
  await servicio.admin!.crear('pruebas', {
    slug: 'kilo-pruebas',
    nombre: 'Kilo Code (pruebas)',
    tipo: 'kilocode',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    modelos,
    herramientas: true,
    apiKey: clave,
  });
  console.log('Proveedor kilo-pruebas creado.');
}
await db.$disconnect();
