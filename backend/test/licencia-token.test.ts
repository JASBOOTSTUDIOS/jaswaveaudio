import { describe, it, expect } from 'vitest';
import { firmarLicencia, verificarLicencia, generarParClaves, VIGENCIA_LICENCIA_SEGUNDOS, type CargaLicencia } from '../src/license/token-licencia.js';

const carga = (exp: number): CargaLicencia => ({
  sub: 'u1',
  email: 'a@b.c',
  dispositivo: 'd1',
  productos: { 'com.jaswave.plugin.param-eq': ['eq.banda'] },
  iat: exp - VIGENCIA_LICENCIA_SEGUNDOS,
  exp,
});

describe('licencias — token firmado Ed25519', () => {
  const { privada, publica } = generarParClaves();
  const ahora = Math.floor(Date.now() / 1000);

  it('una licencia válida se verifica y devuelve su carga', () => {
    const token = firmarLicencia(carga(ahora + VIGENCIA_LICENCIA_SEGUNDOS), privada);
    expect(verificarLicencia(token, publica, ahora).productos).toEqual({ 'com.jaswave.plugin.param-eq': ['eq.banda'] });
  });

  it('una licencia caducada se rechaza', () => {
    const token = firmarLicencia(carga(ahora - 1), privada);
    expect(() => verificarLicencia(token, publica, ahora)).toThrow('expirada');
  });

  it('alterar el payload invalida la firma', () => {
    const token = firmarLicencia(carga(ahora + 100), privada);
    const [v, , f] = token.split('.');
    const forjado = Buffer.from(JSON.stringify({ ...carga(ahora + 100), productos: { x: ['*'] } })).toString('base64url');
    expect(() => verificarLicencia(`${v}.${forjado}.${f}`, publica, ahora)).toThrow('firma inválida');
  });

  it('una firma de otra clave no es aceptada', () => {
    const otra = generarParClaves();
    const token = firmarLicencia(carga(ahora + 100), otra.privada);
    expect(() => verificarLicencia(token, publica, ahora)).toThrow('firma inválida');
  });
});
