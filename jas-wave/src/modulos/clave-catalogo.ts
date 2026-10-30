/**
 * Clave pública Ed25519 con la que el backend firma el catálogo (jwc1). Copia de la del proceso main
 * (electron/plugins/clave-catalogo.ts); un test comprueba que ambas coinciden con
 * plugins/shared-license/keys/licencia_publica.pem.
 */
export const CLAVE_PUBLICA_CATALOGO = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAuv3pbESTP6kPjaKU2/Qj9/ccwtztvMxV+XqjzEiCW4U=
-----END PUBLIC KEY-----
`
