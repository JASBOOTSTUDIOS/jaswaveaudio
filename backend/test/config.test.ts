import { describe, it, expect } from 'vitest';
import { cargarConfiguracion } from '../src/config.js';
import { firmarLicencia, generarParClaves, verificarLicencia } from '../src/license/token-licencia.js';

describe('configuración', () => {
  it('una clave PEM en una línea con \\n literales se restaura y firma licencias válidas', () => {
    const { privada, publica } = generarParClaves();
    const enUnaLinea = privada.replace(/\n/g, '\\n');
    const config = cargarConfiguracion({ LICENSE_SIGNING_KEY_PEM: enUnaLinea });
    const ahora = Math.floor(Date.now() / 1000);
    const token = firmarLicencia(
      { sub: 'u', email: 'e@x.y', dispositivo: 'd', productos: { p: ['a'] }, iat: ahora, exp: ahora + 60 },
      config.clavePrivadaLicencia!,
    );
    expect(verificarLicencia(token, publica, ahora).productos).toEqual({ p: ['a'] });
  });

  it('ADMIN_EMAILS se normaliza a minúsculas y sin espacios', () => {
    const config = cargarConfiguracion({ ADMIN_EMAILS: ' Admin@X.com , otro@y.com ' });
    expect(config.adminsIniciales).toEqual(['admin@x.com', 'otro@y.com']);
  });
});
