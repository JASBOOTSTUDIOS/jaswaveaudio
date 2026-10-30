/**
 * Lectura mínima de un archivo MIDI estándar (SMF) para validar lo que sube el administrador y sacar
 * tempo, compás y duración. No interpreta nada más: el catálogo guarda los bytes tal cual.
 */

export class ErrorMidi extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorMidi';
  }
}

export type NotaMidi = { pitch: number; velocidad: number; inicio: number };
export type ResumenMidi = { pistas: number; ppq: number; notas: number; lista: NotaMidi[]; tempo: number | null; compas: string | null; compases: number };

/** Cabecera `MThd` válida (longitud 6, formato 0–2, al menos una pista, resolución en pulsos por negra). */
export function validarCabeceraMidi(b: Uint8Array): void {
  if (b.length < 22) throw new ErrorMidi('no es un archivo MIDI válido (demasiado corto)');
  if (String.fromCharCode(b[0]!, b[1]!, b[2]!, b[3]!) !== 'MThd') throw new ErrorMidi('no es un archivo MIDI válido (falta la cabecera)');
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (v.getUint32(4) !== 6) throw new ErrorMidi('cabecera MIDI con longitud inesperada');
  if (v.getUint16(8) > 2) throw new ErrorMidi('formato MIDI no soportado');
  if (v.getUint16(10) < 1 || v.getUint16(10) > 64) throw new ErrorMidi('número de pistas MIDI no válido');
  const div = v.getUint16(12);
  if (div & 0x8000 || div === 0) throw new ErrorMidi('solo se admite resolución en pulsos por negra');
}

export function resumirMidi(b: Uint8Array): ResumenMidi {
  validarCabeceraMidi(b);
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const pistas = v.getUint16(10);
  const ppq = v.getUint16(12);
  let pos = 14;
  let notas = 0;
  const lista: NotaMidi[] = [];
  let ultimo = 0;
  let tempo: number | null = null;
  let num = 4;
  let den = 4;
  let compas: string | null = null;
  let leidas = 0;
  while (pos + 8 <= b.length && leidas < pistas) {
    const id = String.fromCharCode(b[pos]!, b[pos + 1]!, b[pos + 2]!, b[pos + 3]!);
    const len = v.getUint32(pos + 4);
    const ini = pos + 8;
    const fin = Math.min(b.length, ini + len);
    pos = ini + len;
    if (id !== 'MTrk') continue;
    leidas++;
    let p = ini;
    let t = 0;
    let estado = 0;
    const varlen = (): number => {
      let x = 0;
      for (let i = 0; i < 4; i++) {
        if (p >= fin) throw new ErrorMidi('pista MIDI truncada');
        const c = b[p++]!;
        x = (x << 7) | (c & 0x7f);
        if (!(c & 0x80)) return x;
      }
      throw new ErrorMidi('tiempo MIDI mal formado');
    };
    while (p < fin) {
      t += varlen();
      if (p >= fin) break;
      let s = b[p]!;
      if (s === 0xff) {
        const tipo = b[p + 1];
        p += 2;
        const l = varlen();
        if (tipo === 0x51 && l === 3 && tempo === null) tempo = Math.round(60_000_000 / ((b[p]! << 16) | (b[p + 1]! << 8) | b[p + 2]!));
        if (tipo === 0x58 && l >= 2 && compas === null) {
          num = b[p]!;
          den = 2 ** b[p + 1]!;
          compas = `${num}/${den}`;
        }
        p += l;
        if (tipo === 0x2f) break;
        continue;
      }
      if (s === 0xf0 || s === 0xf7) {
        p++;
        p += varlen();
        continue;
      }
      if (s & 0x80) {
        estado = s;
        p++;
      } else s = estado;
      if (!estado) throw new ErrorMidi('evento MIDI sin estado previo');
      const tipo = estado & 0xf0;
      const datos = tipo === 0xc0 || tipo === 0xd0 ? 1 : 2;
      if (tipo === 0x90 && b[p + 1]! > 0) {
        notas++;
        lista.push({ pitch: b[p]!, velocidad: b[p + 1]!, inicio: t / ppq });
        if (t > ultimo) ultimo = t;
      }
      p += datos;
    }
  }
  if (leidas === 0) throw new ErrorMidi('el archivo MIDI no tiene pistas');
  const negrasPorCompas = (num * 4) / den;
  const compases = Math.min(64, Math.max(1, Math.round(ultimo / ppq / negrasPorCompas) || 1));
  return { pistas, ppq, notas, lista, tempo, compas, compases };
}
