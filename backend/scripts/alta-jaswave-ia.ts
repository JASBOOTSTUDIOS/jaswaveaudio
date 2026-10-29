import { readFileSync } from 'node:fs';
import { cargarConfiguracion } from '../src/config.js';
import { crearDb } from '../src/db.js';
import { aiChatDirecto } from '../src/ia/gateway/ai-gateway.js';
import { crearServicioJasWave, sembrarJasWaveIA, type EslabonCadena } from '../src/ia/jaswave/servicio.js';
import { crearServicioIA } from '../src/ia/proveedores.js';
import { claveMaestraDesdeBase64 } from '../src/seguridad/cifrado.js';

// Desarrollo local: conexión KiloCode con un grupo de claves (archivo JSON con un array, ruta en
// JW_CLAVES_ARCHIVO) y las cadenas iniciales de los modelos JasWave. Equivale a hacerlo desde el admin.
// No imprime claves.
const archivo = process.env.JW_CLAVES_ARCHIVO;
if (!archivo) {
  console.error('Falta JW_CLAVES_ARCHIVO (JSON con un array de claves).');
  process.exit(1);
}
const claves = JSON.parse(readFileSync(archivo, 'utf8')) as string[];
if (!Array.isArray(claves) || !claves.length) throw new Error('el archivo no tiene claves');

const config = cargarConfiguracion();
const db = crearDb(config.urlBaseDatos);
const claveMaestra = claveMaestraDesdeBase64(config.claveMaestraIA!);
const ia = crearServicioIA({ db, claveMaestra });
const jw = crearServicioJasWave({ db, claveMaestra, permisos: (id) => ia.permisos(id), chat: aiChatDirecto });
await sembrarJasWaveIA(db);

// Medidos con estas claves (oct-2026): sin razonamiento oculto responden en 1,5–4 s.
const SUPER = 'nvidia/nemotron-3.5-super-vl:free';
const ULTRA = 'nvidia/nemotron-3-ultra-550b-a55b:free';
const LIGHT = 'nvidia/nemotron-3.5-lightning:free';
const NORTH = 'cohere/north-mini-code:free';
const BEAM = 'reflection/beam-free';
const DOTS = 'dots-studio/dots-3-note-preview:free';
const ORFREE = 'openrouter/free';
const modelos = [SUPER, ULTRA, LIGHT, NORTH, BEAM, DOTS, ORFREE];

const slug = 'kilo';
let p = await db.proveedorIA.findUnique({ where: { slug } });
if (!p) {
  const creado = await ia.admin!.crear('script', {
    slug,
    nombre: 'Kilo Code (gratuitos)',
    tipo: 'kilocode',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    modelos,
    herramientas: true,
    peticionesPorMinuto: 120,
    apiKey: claves[0],
  });
  p = await db.proveedorIA.findUniqueOrThrow({ where: { id: creado.id } });
  console.log('Conexión creada.');
} else {
  await ia.admin!.actualizar('script', p.id, { modelos, activo: true, herramientas: true });
  await ia.admin!.fijarClave('script', p.id, claves[0]!);
  console.log('Conexión actualizada.');
}
await db.claveProveedorIA.deleteMany({ where: { proveedorId: p.id } });
for (const [i, k] of claves.slice(1).entries()) await jw.admin.agregarClave('script', p.id, k, `Clave ${i + 2}`);
console.log(`Grupo de claves: ${claves.length}.`);

const e = (modelo: string, razonamiento: EslabonCadena['razonamiento'] = 'off'): EslabonCadena => ({ proveedorId: p!.id, modelo, razonamiento });
const cadenas: Record<string, { nombre: string; descripcion: string; cadena: EslabonCadena[] }> = {
  rapido: { nombre: 'JasWave Rápido', descripcion: 'Respuestas y ediciones al instante.', cadena: [e(SUPER), e(LIGHT), e(BEAM, 'normal'), e(NORTH), e(ULTRA), e(ORFREE, 'normal')] },
  creativo: { nombre: 'JasWave Creativo', descripcion: 'Composición y arreglos con más imaginación.', cadena: [e(SUPER), e(DOTS), e(ULTRA), e(NORTH), e(BEAM, 'normal')] },
  profundo: { nombre: 'JasWave Profundo', descripcion: 'Análisis detallado; tarda un poco más.', cadena: [e(ULTRA, 'bajo'), e(SUPER, 'bajo'), e(BEAM, 'normal'), e(DOTS, 'normal')] },
};
for (const [id, d] of Object.entries(cadenas)) await jw.admin.guardarModelo('script', id, d);
console.log('Modelos JasWave: rapido, creativo, profundo.');

// Las conexiones directas ya no se conceden a usuarios: quitan la acción del proveedor antiguo de pruebas.
const viejo = await db.proveedorIA.findUnique({ where: { slug: 'kilo-pruebas' } });
if (viejo) {
  await ia.admin!.actualizar('script', viejo.id, { activo: false });
  console.log('Conexión antigua «kilo-pruebas» desactivada.');
}
await db.$disconnect();
