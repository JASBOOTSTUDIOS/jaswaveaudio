import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';

/** Vigencia de la licencia firmada: al vencer, el VST deja de funcionar sin renovar. */
export const VIGENCIA_LICENCIA_SEGUNDOS = 24 * 60 * 60;

export type CargaLicencia = {
  sub: string; // usuario
  email: string;
  dispositivo: string;
  productos: Record<string, string[]>; // productoId -> acciones permitidas
  iat: number;
  exp: number;
};

const codificar = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url');

/** Formato: `jwl1.<payload base64url>.<firma Ed25519 base64url>`. No es JWT: el VST lo verifica sin red. */
export function firmarLicencia(carga: CargaLicencia, clavePrivadaPem: string): string {
  const clave: KeyObject = createPrivateKey(clavePrivadaPem);
  const payload = codificar(carga);
  const firma = sign(null, Buffer.from(`jwl1.${payload}`), clave).toString('base64url');
  return `jwl1.${payload}.${firma}`;
}

export function verificarLicencia(token: string, clavePublicaPem: string, ahoraSeg: number): CargaLicencia {
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== 'jwl1') throw new Error('formato inválido');
  const [, payload, firma] = partes as [string, string, string];
  const ok = verify(null, Buffer.from(`jwl1.${payload}`), createPublicKey(clavePublicaPem), Buffer.from(firma, 'base64url'));
  if (!ok) throw new Error('firma inválida');
  const carga = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as CargaLicencia;
  if (carga.exp <= ahoraSeg) throw new Error('licencia expirada');
  return carga;
}

export function generarParClaves(): { privada: string; publica: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privada: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publica: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
