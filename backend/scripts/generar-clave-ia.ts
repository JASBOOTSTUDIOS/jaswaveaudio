import { generarClaveMaestra } from '../src/seguridad/cifrado.js';

// Clave maestra para cifrar en la BD las claves de los proveedores de IA. Va al .env del backend.
// Guárdala también en un gestor de secretos: si se pierde, las claves guardadas no se pueden recuperar.
process.stdout.write(`IA_CLAVE_MAESTRA="${generarClaveMaestra()}"\n`);
