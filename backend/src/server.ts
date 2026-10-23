import http from 'node:http';
import { pino } from 'pino';
import { cargarConfiguracion } from './config.js';
import { crearApp } from './app.js';
import { claveDesdeJwksRemoto, crearVerificadorJwt } from './auth/verificador-jwt.js';
import { crearDb } from './db.js';

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

const verificar = crearVerificadorJwt({
  claves: claveDesdeJwksRemoto(config.jwksUrl),
  ...(config.emisorJwt ? { emisor: config.emisorJwt } : {}),
  adminsIniciales: config.adminsIniciales,
});

const db = crearDb(config.urlBaseDatos);
const app = crearApp({
  verificar,
  origenesCors: config.origenesCors,
  datos: { db, clavePrivadaPem: config.clavePrivadaLicencia, reloj: () => new Date() },
});
const servidor = http.createServer(app);
servidor.listen(config.puerto, () => log.info({ puerto: config.puerto }, 'backend escuchando'));
