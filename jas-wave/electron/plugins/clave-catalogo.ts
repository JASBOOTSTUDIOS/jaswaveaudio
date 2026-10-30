/**
 * Clave pública Ed25519 con la que el backend firma licencias (jwl1) y el catálogo de paquetes (jwc1).
 * Debe coincidir con plugins/shared-license/keys/licencia_publica.pem (lo comprueba clave-catalogo.test.ts).
 */
export const CLAVE_PUBLICA_JASWAVE = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuv3pbESTP6kPjaKU2/Qj9/ccwtztvMxV+XqjzEiCW4U=
-----END PUBLIC KEY-----
`
