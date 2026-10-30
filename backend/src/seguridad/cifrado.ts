/**
 * Cifrado en reposo de secretos (claves de proveedores de IA) con AES-256-GCM y clave maestra.
 * Formato: iv(12) | tag(16) | texto cifrado. El AAD liga el blob a su dueño (p. ej. `proveedorId:version`):
 * copiar un blob a otra fila no lo hace descifrable.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export type ClaveMaestra = Buffer;

/** Valida y decodifica IA_CLAVE_MAESTRA (32 bytes en base64). */
export function claveMaestraDesdeBase64(b64: string): ClaveMaestra {
  const clave = Buffer.from(b64.trim(), 'base64');
  if (clave.length !== 32) throw new Error('IA_CLAVE_MAESTRA debe ser de 32 bytes en base64');
  return clave;
}

export function generarClaveMaestra(): string {
  return randomBytes(32).toString('base64');
}

export function cifrarSecreto(clave: ClaveMaestra, texto: string, aad: string): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', clave, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const cuerpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), cuerpo]);
}

export function descifrarSecreto(clave: ClaveMaestra, blob: Uint8Array, aad: string): string {
  const b = Buffer.from(blob);
  if (b.length < 29) throw new Error('secreto cifrado inválido');
  const d = createDecipheriv('aes-256-gcm', clave, b.subarray(0, 12));
  d.setAAD(Buffer.from(aad, 'utf8'));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
}
