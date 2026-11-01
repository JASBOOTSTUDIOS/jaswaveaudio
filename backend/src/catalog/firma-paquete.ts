/**
 * Firma de paquetes `.jwx` (X1). Debe coincidir con jas-wave/electron/plugins/firma-paquete.ts, que la
 * verifica: Ed25519 sobre `jwx1.` + JSON canónico de `{ id, version, archivos }` (rutas ordenadas).
 * La clave privada solo vive en el backend; el empaquetador manda el manifiesto de archivos y recibe
 * `jaswave-firma.json`.
 */

import { createPrivateKey, sign } from 'node:crypto';

export type FirmaPaquete = { version: 1; id: string; versionPaquete: string; archivos: Record<string, string>; firma: string };

export function mensajeFirma(id: string, version: string, archivos: Record<string, string>): Buffer {
  const ordenados = Object.fromEntries(Object.keys(archivos).sort().map((k) => [k, archivos[k]]));
  return Buffer.from(`jwx1.${JSON.stringify({ id, version, archivos: ordenados })}`);
}

export function firmarPaquete(id: string, version: string, archivos: Record<string, string>, clavePrivadaPem: string): FirmaPaquete {
  const firma = sign(null, mensajeFirma(id, version, archivos), createPrivateKey(clavePrivadaPem)).toString('base64url');
  return { version: 1, id, versionPaquete: version, archivos, firma };
}
