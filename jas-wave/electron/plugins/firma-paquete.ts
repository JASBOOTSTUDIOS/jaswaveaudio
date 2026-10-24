/**
 * Firma de paquetes `.jwx` (X1), equivalente a la de los `.vsix` firmados de VS Code.
 *
 * Un `.jwx` es un zip con `jaswave-plugin.json`, su contenido (`dist/` en módulos, `vst3/` en plugins) y
 * `jaswave-firma.json`:
 *
 *   { "version": 1, "id": "...", "versionPaquete": "1.0.0", "archivos": { "<ruta>": "<sha256>" }, "firma": "<base64url>" }
 *
 * La firma es Ed25519 (la clave de JasWave, la misma del catálogo y las licencias) sobre
 * `jwx1.` + JSON canónico de `{ id, version, archivos }` con las rutas ordenadas. `archivos` debe listar
 * exactamente todos los archivos del paquete salvo la propia firma: si sobra o falta uno, no vale.
 */

import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'

export const ARCHIVO_FIRMA = 'jaswave-firma.json'
export const EXTENSION_PAQUETE = '.jwx'

export type FirmaPaquete = { version: 1; id: string; versionPaquete: string; archivos: Record<string, string>; firma: string }

export function mensajeFirma(id: string, version: string, archivos: Record<string, string>): Buffer {
  const ordenados = Object.fromEntries(Object.keys(archivos).sort().map((k) => [k, archivos[k]]))
  return Buffer.from(`jwx1.${JSON.stringify({ id, version, archivos: ordenados })}`)
}

export function firmarPaquete(id: string, version: string, archivos: Record<string, string>, clavePrivadaPem: string): FirmaPaquete {
  const firma = sign(null, mensajeFirma(id, version, archivos), createPrivateKey(clavePrivadaPem)).toString('base64url')
  return { version: 1, id, versionPaquete: version, archivos, firma }
}

export type ResultadoFirma = { estado: 'valida'; firma: FirmaPaquete } | { estado: 'ausente' } | { estado: 'invalida'; motivo: string }

/**
 * Comprueba la firma frente a lo que hay realmente en el paquete (`hashesReales`, sin la firma) y al
 * manifiesto. Acepta varias claves públicas (la oficial y, solo en desarrollo, una de pruebas).
 */
export function verificarFirmaPaquete(
  texto: string | null,
  esperado: { id: string; version: string },
  hashesReales: Record<string, string>,
  clavesPublicasPem: string[],
): ResultadoFirma {
  if (texto === null) return { estado: 'ausente' }
  let f: Partial<FirmaPaquete>
  try {
    f = JSON.parse(texto) as Partial<FirmaPaquete>
  } catch {
    return { estado: 'invalida', motivo: 'jaswave-firma.json no es JSON' }
  }
  if (f.version !== 1 || typeof f.firma !== 'string' || !f.archivos || typeof f.archivos !== 'object') {
    return { estado: 'invalida', motivo: 'formato de firma no reconocido' }
  }
  if (f.id !== esperado.id || f.versionPaquete !== esperado.version) return { estado: 'invalida', motivo: 'la firma es de otro paquete o versión' }
  const firmados = f.archivos as Record<string, unknown>
  const reales = Object.keys(hashesReales)
  for (const rel of reales) if (firmados[rel] !== hashesReales[rel]) return { estado: 'invalida', motivo: `archivo modificado o no firmado: ${rel}` }
  for (const rel of Object.keys(firmados)) if (!(rel in hashesReales)) return { estado: 'invalida', motivo: `falta un archivo firmado: ${rel}` }
  const mensaje = mensajeFirma(esperado.id, esperado.version, hashesReales)
  const firma = Buffer.from(f.firma, 'base64url')
  for (const pem of clavesPublicasPem) {
    try {
      if (verify(null, mensaje, createPublicKey(pem), firma)) return { estado: 'valida', firma: f as FirmaPaquete }
    } catch {
      /* clave ilegible: se prueba la siguiente */
    }
  }
  return { estado: 'invalida', motivo: 'la firma no es de JasWave' }
}
