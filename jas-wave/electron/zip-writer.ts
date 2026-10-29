/**
 * Escritor ZIP mínimo, sin dependencias (G2: «Exportar proyecto empaquetado»).
 *
 * - Textos (el `.jaswave`) van comprimidos con deflate; el audio va sin comprimir (STORE): WAV/FLAC/MP3
 *   apenas ganan y así el archivo se escribe por trozos sin cargarlo entero en memoria.
 * - Sin ZIP64: si el paquete pasara de 4 GiB se avisa en vez de escribir un zip corrupto.
 * - Nombres en UTF-8 (bit 11), rutas con `/`, sin `..` ni absolutas.
 */

import * as fs from 'node:fs/promises'
import { deflateRawSync } from 'node:zlib'

const LIMITE_ZIP32 = 0xffffffff
const TROZO = 1024 * 1024

const TABLA_CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(datos: Uint8Array, previo = 0): number {
  let c = (previo ^ 0xffffffff) >>> 0
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]!) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

export type EntradaZip =
  | { nombre: string; texto: string }
  | { nombre: string; archivo: string }

/** Nombre de entrada seguro: relativo, con `/`, sin `..` ni unidad. */
export function nombreEntradaSeguro(nombre: string): string {
  const n = nombre.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!n || /^[a-zA-Z]:/.test(n) || n.split('/').some((p) => p === '..' || p === '')) {
    throw new Error(`nombre de entrada no válido en el zip: ${nombre}`)
  }
  return n
}

function fechaDos(d = new Date()): { hora: number; fecha: number } {
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    fecha: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

type Registro = { nombre: Buffer; metodo: number; crc: number; comprimido: number; original: number; offset: number }

function cabeceraLocal(r: Omit<Registro, 'offset'>, t: { hora: number; fecha: number }): Buffer {
  const b = Buffer.alloc(30)
  b.writeUInt32LE(0x04034b50, 0)
  b.writeUInt16LE(20, 4)
  b.writeUInt16LE(0x0800, 6) // UTF-8
  b.writeUInt16LE(r.metodo, 8)
  b.writeUInt16LE(t.hora, 10)
  b.writeUInt16LE(t.fecha, 12)
  b.writeUInt32LE(r.crc, 14)
  b.writeUInt32LE(r.comprimido, 18)
  b.writeUInt32LE(r.original, 22)
  b.writeUInt16LE(r.nombre.length, 26)
  b.writeUInt16LE(0, 28)
  return Buffer.concat([b, r.nombre])
}

function cabeceraCentral(r: Registro, t: { hora: number; fecha: number }): Buffer {
  const b = Buffer.alloc(46)
  b.writeUInt32LE(0x02014b50, 0)
  b.writeUInt16LE(20, 4)
  b.writeUInt16LE(20, 6)
  b.writeUInt16LE(0x0800, 8)
  b.writeUInt16LE(r.metodo, 10)
  b.writeUInt16LE(t.hora, 12)
  b.writeUInt16LE(t.fecha, 14)
  b.writeUInt32LE(r.crc, 16)
  b.writeUInt32LE(r.comprimido, 20)
  b.writeUInt32LE(r.original, 24)
  b.writeUInt16LE(r.nombre.length, 28)
  b.writeUInt32LE(r.offset, 42)
  return Buffer.concat([b, r.nombre])
}

/** Escribe el zip en `destino` (se crea en `destino.parcial` y se renombra al terminar). */
export async function escribirZip(destino: string, entradas: EntradaZip[], alProgreso?: (hechos: number, total: number) => void): Promise<number> {
  const temporal = `${destino}.parcial`
  const fh = await fs.open(temporal, 'w')
  const t = fechaDos()
  const registros: Registro[] = []
  const vistos = new Set<string>()
  let pos = 0
  const escribir = async (buf: Uint8Array, en?: number) => {
    await fh.write(buf, 0, buf.length, en ?? pos)
    if (en === undefined) pos += buf.length
  }
  try {
    for (let i = 0; i < entradas.length; i++) {
      const e = entradas[i]!
      const nombreTxt = nombreEntradaSeguro(e.nombre)
      if (vistos.has(nombreTxt.toLowerCase())) throw new Error(`entrada repetida en el zip: ${nombreTxt}`)
      vistos.add(nombreTxt.toLowerCase())
      const nombre = Buffer.from(nombreTxt, 'utf8')
      const offset = pos
      if ('texto' in e) {
        const original = Buffer.from(e.texto, 'utf8')
        const comprimido = deflateRawSync(original, { level: 9 })
        const r = { nombre, metodo: 8, crc: crc32(original), comprimido: comprimido.length, original: original.length }
        await escribir(cabeceraLocal(r, t))
        await escribir(comprimido)
        registros.push({ ...r, offset })
      } else {
        const st = await fs.stat(e.archivo)
        if (st.size > LIMITE_ZIP32 || pos + st.size > LIMITE_ZIP32) {
          throw new Error('El paquete supera 4 GiB (límite del formato ZIP sin ZIP64). Exporta sin algunos audios o en varias partes.')
        }
        const r = { nombre, metodo: 0, crc: 0, comprimido: st.size, original: st.size }
        const inicioCabecera = pos
        await escribir(cabeceraLocal(r, t))
        const fin = await fs.open(e.archivo, 'r')
        let crc = 0
        try {
          const buf = Buffer.alloc(TROZO)
          let leidos = 0
          while (leidos < st.size) {
            const { bytesRead } = await fin.read(buf, 0, Math.min(TROZO, st.size - leidos), leidos)
            if (bytesRead <= 0) break
            const trozo = buf.subarray(0, bytesRead)
            crc = crc32(trozo, crc)
            await escribir(trozo)
            leidos += bytesRead
          }
          if (leidos !== st.size) throw new Error(`el archivo cambió mientras se empaquetaba: ${e.archivo}`)
        } finally {
          await fin.close()
        }
        // El CRC se conoce al final: se parchea en la cabecera local.
        const crcBuf = Buffer.alloc(4)
        crcBuf.writeUInt32LE(crc, 0)
        await escribir(crcBuf, inicioCabecera + 14)
        registros.push({ ...r, crc, offset })
      }
      alProgreso?.(i + 1, entradas.length)
    }
    const inicioCentral = pos
    for (const r of registros) await escribir(cabeceraCentral(r, t))
    const tamCentral = pos - inicioCentral
    const fin = Buffer.alloc(22)
    fin.writeUInt32LE(0x06054b50, 0)
    fin.writeUInt16LE(registros.length, 8)
    fin.writeUInt16LE(registros.length, 10)
    fin.writeUInt32LE(tamCentral, 12)
    fin.writeUInt32LE(inicioCentral, 16)
    await escribir(fin)
    await fh.close()
    await fs.rm(destino, { force: true })
    await fs.rename(temporal, destino)
    return pos
  } catch (err) {
    await fh.close().catch(() => undefined)
    await fs.rm(temporal, { force: true }).catch(() => undefined)
    throw err
  }
}
