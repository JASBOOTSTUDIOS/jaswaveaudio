/**
 * Red restringida para peticiones salientes hacia URLs de usuarios: cada conexión vuelve a resolver el
 * host y rechaza IPs privadas en el momento de conectar (evita DNS rebinding entre la validación y el
 * fetch) y no sigue redirecciones. Se activa con `conRedRestringida(fn)`; el gateway de IA consulta
 * `fetchActual()` para usarla.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { Agent, fetch as undiciFetch } from 'undici';
import { esIpPrivada } from './url-segura.js';

type Fetch = typeof fetch;

const contexto = new AsyncLocalStorage<{ fetch: Fetch }>();

function lookupSeguro(
  host: string,
  opciones: object,
  cb: (err: NodeJS.ErrnoException | null, direccion: string | LookupAddress[], familia?: number) => void,
): void {
  dnsLookup(host, { ...opciones, all: true }, (err, direcciones) => {
    if (err) return cb(err, '');
    const lista = direcciones as LookupAddress[];
    if (!lista.length || lista.some((d) => esIpPrivada(d.address))) {
      const e: NodeJS.ErrnoException = new Error(`destino no permitido: ${host}`);
      e.code = 'EJASWAVE_RED_PRIVADA';
      return cb(e, '');
    }
    if ((opciones as { all?: boolean }).all) return cb(null, lista);
    cb(null, lista[0]!.address, lista[0]!.family);
  });
}

let agente: Agent | null = null;

function fetchRestringido(): Fetch {
  agente ??= new Agent({ connect: { lookup: lookupSeguro as never } });
  const a = agente;
  return ((url: string | URL | Request, init?: RequestInit) =>
    undiciFetch(url as never, { ...(init as object), dispatcher: a, redirect: 'manual' } as never)) as unknown as Fetch;
}

/** Ejecuta fn con el fetch restringido activo para todo lo que llame (incluidos awaits anidados). */
export function conRedRestringida<T>(fn: () => Promise<T>): Promise<T> {
  return contexto.run({ fetch: fetchRestringido() }, fn);
}

/** Fetch a usar: el restringido dentro de `conRedRestringida`, el global fuera. */
export function fetchActual(): Fetch {
  return contexto.getStore()?.fetch ?? fetch;
}
