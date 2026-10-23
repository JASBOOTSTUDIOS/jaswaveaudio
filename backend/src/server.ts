import http from 'node:http';
import { pino } from 'pino';
import { cargarConfiguracion } from './config.js';
import { crearApp } from './app.js';
import { claveDesdeJwksRemoto, crearVerificadorJwt } from './auth/verificador-jwt.js';
import { crearDb } from './db.js';
import { createPrivateKey } from 'node:crypto';
import { adjuntarSync } from './sync/servidor.js';
import { crearServicioIA, sembrarProductoIA } from './ia/proveedores.js';
import { claveMaestraDesdeBase64, type ClaveMaestra } from './seguridad/cifrado.js';

const config = cargarConfiguracion();
const log = pino({ level: config.nivelLog });

if (!config.jwksUrl) {
  log.error('SUPABASE_JWKS_URL no configurado');
  process.exit(1);
}
if (!config.clavePrivadaLicencia) {
  log.error('LICENSE_SIGNING_KEY_PEM no configurado (ejecuta `npm run licencias:generar-claves`)');
  process.exit(1);
}

try {
  const clave = createPrivateKey(config.clavePrivadaLicencia);
  if (clave.asymmetricKeyType !== 'ed25519') throw new Error('la clave no es Ed25519');
} catch (err) {
  log.error({ err }, 'LICENSE_SIGNING_KEY_PEM inválida');
  process.exit(1);
}

let claveMaestraIA: ClaveMaestra | null = null;
if (config.claveMaestraIA) {
  try {
    claveMaestraIA = claveMaestraDesdeBase64(config.claveMaestraIA);
  } catch (err) {
    log.error({ err }, 'IA_CLAVE_MAESTRA inválida');
    process.exit(1);
  }
} else {
  log.warn('IA_CLAVE_MAESTRA no configurada: no se podrán guardar ni usar claves de proveedores de IA (ejecuta `npm run ia:generar-clave`)');
}

const verificar = crearVerificadorJwt({
  claves: claveDesdeJwksRemoto(config.jwksUrl),
  ...(config.emisorJwt ? { emisor: config.emisorJwt } : {}),
  adminsIniciales: config.adminsIniciales,
});

const db = crearDb(config.urlBaseDatos);
const app = crearApp({
  verificar,
  origenesCors: config.origenesCors,
  log,
  ia: crearServicioIA({ db, claveMaestra: claveMaestraIA }),
  datos: { db, clavePrivadaPem: config.clavePrivadaLicencia, reloj: () => new Date() },
});
// Producto del asistente y acciones base para que el admin pueda asignarlas desde el primer arranque.
await sembrarProductoIA(db).catch((err: unknown) => log.error({ err }, 'no se pudo sembrar el producto de IA'));
const servidor = http.createServer(app);
adjuntarSync(servidor, { db, verificar });
servidor.listen(config.puerto, () => log.info({ puerto: config.puerto }, 'backend escuchando'));
