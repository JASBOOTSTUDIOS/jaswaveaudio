/**
 * Entorno determinista de ejecución de comandos.
 *
 * Los handlers no deben llamar a `Date.now()`, `Math.random()` ni `crypto.randomUUID()` directamente,
 * sino a `entorno.ahora()`, `entorno.aleatorio()` y `entorno.uuid()`. Fuera de un comando delegan en los
 * reales; dentro de `conEntorno(e, fn)` devuelven valores derivados de `e` (tiempo fijo + PRNG con semilla).
 *
 * Así un comando replicado (colaboración en tiempo real) se reaplica en cada réplica con el mismo
 * `EntornoComando` que usó su autor y produce exactamente los mismos ids y marcas de tiempo.
 * Es seguro con handlers async porque el ejecutor serializa todos los comandos en una única cola.
 */

export type EntornoComando = {
  /** Marca de tiempo (ms) que verán los handlers. */
  ahora: number;
  /** Semilla de 32 bits del generador pseudoaleatorio. */
  semilla: number;
};

type Proveedor = { ahora: () => number; aleatorio: () => number };

/** PRNG mulberry32: rápido, 32 bits de estado y reproducible en cualquier motor JS. */
function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pila: Proveedor[] = [];

function uuidDesde(aleatorio: () => number): string {
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(aleatorio() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40; // versión 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const entorno = {
  ahora(): number {
    const p = pila[pila.length - 1];
    return p ? p.ahora() : Date.now();
  },
  aleatorio(): number {
    const p = pila[pila.length - 1];
    return p ? p.aleatorio() : Math.random();
  },
  uuid(): string {
    const p = pila[pila.length - 1];
    return p ? uuidDesde(p.aleatorio) : crypto.randomUUID();
  },
};

/** Crea un entorno nuevo para un comando local (tiempo real y semilla aleatoria). */
export function nuevoEntorno(): EntornoComando {
  return { ahora: Date.now(), semilla: Math.floor(Math.random() * 0x100000000) >>> 0 };
}

/** Ejecuta `fn` con el entorno indicado; anidable (los batch abren un entorno por comando). */
export async function conEntorno<T>(e: EntornoComando, fn: () => T | Promise<T>): Promise<T> {
  pila.push({ ahora: () => e.ahora, aleatorio: mulberry32(e.semilla) });
  try {
    return await fn();
  } finally {
    pila.pop();
  }
}
