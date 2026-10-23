import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { claveMaestraDesdeBase64, cifrarSecreto, descifrarSecreto, generarClaveMaestra } from '../src/seguridad/cifrado.js';
import { esIpPrivada, exigirUrlPublica } from '../src/seguridad/url-segura.js';
import { conRedRestringida, fetchActual } from '../src/seguridad/red-restringida.js';

describe('cifrado de secretos (AES-256-GCM con clave maestra)', () => {
  const clave = claveMaestraDesdeBase64(generarClaveMaestra());

  it('ida y vuelta; cada cifrado usa un IV distinto', () => {
    const a = cifrarSecreto(clave, 'sk-secreta', 'p1:1');
    const b = cifrarSecreto(clave, 'sk-secreta', 'p1:1');
    expect(a.equals(b)).toBe(false);
    expect(descifrarSecreto(clave, a, 'p1:1')).toBe('sk-secreta');
    expect(a.toString('utf8')).not.toContain('sk-secreta');
  });

  it('el AAD liga el blob a su fila y versión; otra clave maestra no lo abre; manipularlo falla', () => {
    const blob = cifrarSecreto(clave, 'sk', 'p1:1');
    expect(() => descifrarSecreto(clave, blob, 'p2:1')).toThrow();
    expect(() => descifrarSecreto(clave, blob, 'p1:2')).toThrow();
    expect(() => descifrarSecreto(claveMaestraDesdeBase64(generarClaveMaestra()), blob, 'p1:1')).toThrow();
    const roto = Buffer.from(blob);
    roto[roto.length - 1]! ^= 1;
    expect(() => descifrarSecreto(clave, roto, 'p1:1')).toThrow();
  });

  it('rechaza claves maestras que no son de 32 bytes', () => {
    expect(() => claveMaestraDesdeBase64(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('protección SSRF', () => {
  it('clasifica IPs privadas, internas y mapeadas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(esIpPrivada(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) expect(esIpPrivada(ip), ip).toBe(false);
  });

  it('exige http(s) público, sin credenciales, y comprueba lo que resuelve el DNS', async () => {
    const dns = (mapa: Record<string, string[]>) => async (h: string) => mapa[h] ?? [];
    await expect(exigirUrlPublica('https://api.openai.com/v1', dns({ 'api.openai.com': ['104.18.7.192'] }))).resolves.toBeUndefined();
    await expect(exigirUrlPublica('file:///etc/passwd')).rejects.toThrow(/http/);
    await expect(exigirUrlPublica('http://user:pw@example.com')).rejects.toThrow(/credenciales/);
    await expect(exigirUrlPublica('http://localhost:11434')).rejects.toThrow(/interno/);
    await expect(exigirUrlPublica('http://127.0.0.1:11434')).rejects.toThrow(/privada/);
    await expect(exigirUrlPublica('http://[::1]:8080')).rejects.toThrow(/privada/);
    await expect(exigirUrlPublica('http://169.254.169.254/latest/meta-data')).rejects.toThrow(/privada/);
    await expect(exigirUrlPublica('https://trampa.example', dns({ 'trampa.example': ['93.184.216.34', '10.0.0.5'] }))).rejects.toThrow(/privada/);
    await expect(exigirUrlPublica('https://nada.example', dns({}))).rejects.toThrow(/no resuelve/);
  });

  describe('red restringida al conectar (anti DNS rebinding)', () => {
    const servidor = http.createServer((_q, r) => r.end('interno'));
    let url = '';
    beforeAll(async () => {
      await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
      url = `http://localhost:${(servidor.address() as AddressInfo).port}/`;
    });
    afterAll(async () => {
      await new Promise<void>((ok) => servidor.close(() => ok()));
    });

    it('fuera del contexto el fetch es el normal; dentro, conectar a una IP privada falla', async () => {
      expect(await (await fetchActual()(url)).text()).toBe('interno');
      await expect(conRedRestringida(() => fetchActual()(url))).rejects.toThrow();
    });
  });
});
