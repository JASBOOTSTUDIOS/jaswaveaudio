/**
 * Lector de .zip mínimo (almacenado y deflate) para importar grooves en lote. Defensivo: límites de
 * entradas y de tamaño descomprimido (contra bombas zip), sin cifrado, sin multi-disco.
 */

import { inflateRawSync } from 'node:zlib';

export type EntradaZip = { nombre: string; datos: Buffer };
export class ErrorZip extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorZip';
  }
}

export type LimitesZip = { maxEntradas: number; maxBytesEntrada: number; maxBytesTotal: number };

export function leerZip(zip: Buffer, limites: LimitesZip): EntradaZip[] {
  // Fin del directorio central: firma 0x06054b50 en los últimos 64 KB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65_535); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ErrorZip('el archivo no es un zip válido');
  const total = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  if (total > limites.maxEntradas * 4) throw new ErrorZip('el zip tiene demasiados elementos');
  const salida: EntradaZip[] = [];
  let acumulado = 0;
  for (let n = 0; n < total; n++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== 0x02014b50) throw new ErrorZip('directorio del zip dañado');
    const flags = zip.readUInt16LE(pos + 8);
    const metodo = zip.readUInt16LE(pos + 10);
    const tamComp = zip.readUInt32LE(pos + 20);
    const tamReal = zip.readUInt32LE(pos + 24);
    const lNombre = zip.readUInt16LE(pos + 28);
    const lExtra = zip.readUInt16LE(pos + 30);
    const lComent = zip.readUInt16LE(pos + 32);
    const local = zip.readUInt32LE(pos + 42);
    const nombre = zip.subarray(pos + 46, pos + 46 + lNombre).toString(flags & 0x800 ? 'utf8' : 'latin1');
    pos += 46 + lNombre + lExtra + lComent;
    if (nombre.endsWith('/')) continue; // carpeta
    if (!/\.(mid|midi)$/i.test(nombre)) continue; // se ignoran README, .json, etc.
    if (flags & 1) throw new ErrorZip(`«${nombre}» está cifrado`);
    if (salida.length >= limites.maxEntradas) throw new ErrorZip(`el zip tiene más de ${limites.maxEntradas} archivos MIDI`);
    if (tamReal > limites.maxBytesEntrada) throw new ErrorZip(`«${nombre}» es demasiado grande`);
    acumulado += tamReal;
    if (acumulado > limites.maxBytesTotal) throw new ErrorZip('el contenido del zip es demasiado grande');
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new ErrorZip('entrada del zip dañada');
    const ini = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const comp = zip.subarray(ini, ini + tamComp);
    let datos: Buffer;
    if (metodo === 0) datos = Buffer.from(comp);
    else if (metodo === 8) {
      try {
        datos = inflateRawSync(comp, { maxOutputLength: limites.maxBytesEntrada });
      } catch {
        throw new ErrorZip(`no se pudo descomprimir «${nombre}»`);
      }
    } else throw new ErrorZip(`«${nombre}» usa una compresión no soportada`);
    salida.push({ nombre: nombre.replace(/\\/g, '/'), datos });
  }
  return salida;
}
