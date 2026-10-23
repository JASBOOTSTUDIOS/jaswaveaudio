/**
 * Protección SSRF para URLs que aporta un usuario (proveedores de IA propios ejecutados en el servidor):
 * solo http(s), sin credenciales en la URL, y el host debe resolver únicamente a direcciones públicas.
 * Bloquea loopback, redes privadas, link-local (incl. metadatos 169.254.169.254), CGNAT, multicast,
 * IPv6 ULA/link-local y direcciones IPv4 mapeadas en IPv6.
 */

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type Resolver = (host: string) => Promise<string[]>;

const resolverDns: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((r) => r.address);

function ipv4APartes(ip: string): number[] {
  return ip.split('.').map(Number);
}

export function esIpPrivada(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ipv4APartes(ip) as [number, number, number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (v === 6) {
    const x = ip.toLowerCase().replace(/^\[|\]$/g, '');
    if (x === '::' || x === '::1') return true;
    const mapeada = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapeada) return esIpPrivada(mapeada[1]!);
    if (/^::ffff:/.test(x)) return true;
    return /^(fc|fd|fe[89ab]|ff)/.test(x) || x.startsWith('64:ff9b:') || x.startsWith('2001:db8');
  }
  return true;
}

export class UrlNoPermitida extends Error {
  constructor(motivo: string) {
    super(motivo);
    this.name = 'UrlNoPermitida';
  }
}

/** Lanza UrlNoPermitida si la URL no es segura para que el servidor la consulte. */
export async function exigirUrlPublica(url: string, resolver: Resolver = resolverDns): Promise<void> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new UrlNoPermitida('URL inválida');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UrlNoPermitida('solo http(s)');
  if (u.username || u.password) throw new UrlNoPermitida('la URL no puede llevar credenciales');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UrlNoPermitida('host interno no permitido');
  }
  const ips = isIP(host) ? [host] : await resolver(host).catch(() => [] as string[]);
  if (!ips.length) throw new UrlNoPermitida('el host no resuelve');
  if (ips.some(esIpPrivada)) throw new UrlNoPermitida('el host apunta a una red privada o interna');
}
