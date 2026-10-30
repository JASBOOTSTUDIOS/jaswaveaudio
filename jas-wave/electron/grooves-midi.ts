/**
 * Resumen mínimo de un .mid para indexar grooves (M) desde el proceso main: tempo, compás, notas y duración.
 * (El main se compila aparte y no importa `shared/`; la lectura completa de notas la hace el renderer con `leerSmf`.)
 */

export type ResumenMidi = {
  bpm: number
  compas?: { numerador: number; denominador: number }
  /** Final de la última nota, en beats (negras). */
  duracionBeats: number
  notas: number
}

export function resumirMidi(bin: Uint8Array): ResumenMidi {
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const tag = (o: number) => String.fromCharCode(bin[o]!, bin[o + 1]!, bin[o + 2]!, bin[o + 3]!)
  if (bin.length < 14 || tag(0) !== 'MThd') throw new Error('no es un archivo MIDI (falta MThd)')
  const nPistas = dv.getUint16(10)
  const division = dv.getUint16(12)
  if (division & 0x8000 || division === 0) throw new Error('MIDI con división SMPTE no soportada')
  let o = 8 + dv.getUint32(4)
  let bpm: number | undefined
  let compas: ResumenMidi['compas']
  let notas = 0
  let finTicks = 0
  for (let k = 0; k < nPistas && o + 8 <= bin.length; k++) {
    if (tag(o) !== 'MTrk') throw new Error(`bloque inesperado en la pista ${k}`)
    const fin = Math.min(bin.length, o + 8 + dv.getUint32(o + 4))
    let p = o + 8
    let tick = 0
    let estado = 0
    const leerVlq = () => {
      let v = 0
      for (let i = 0; i < 4 && p < fin; i++) {
        const b = bin[p++]!
        v = (v << 7) | (b & 0x7f)
        if (!(b & 0x80)) break
      }
      return v
    }
    while (p < fin) {
      tick += leerVlq()
      let st = bin[p]!
      if (st & 0x80) p++
      else st = estado
      if (st === 0xff) {
        const tipo = bin[p++]!
        const len = leerVlq()
        if (tipo === 0x51 && len === 3 && bpm === undefined) bpm = 60_000_000 / ((bin[p]! << 16) | (bin[p + 1]! << 8) | bin[p + 2]!)
        else if (tipo === 0x58 && len >= 2 && !compas) compas = { numerador: bin[p]!, denominador: 2 ** bin[p + 1]! }
        p += len
        continue
      }
      if (st === 0xf0 || st === 0xf7) {
        p += leerVlq()
        continue
      }
      estado = st
      const tipo = st & 0xf0
      const d1 = bin[p++]!
      const d2 = tipo === 0xc0 || tipo === 0xd0 ? 0 : bin[p++]!
      if (tipo === 0x90 && d2 > 0) notas++
      if (tipo === 0x80 || tipo === 0x90) finTicks = Math.max(finTicks, tick)
      void d1
    }
    o = fin
  }
  return { bpm: bpm && Number.isFinite(bpm) ? bpm : 120, compas, duracionBeats: finTicks / division, notas }
}
