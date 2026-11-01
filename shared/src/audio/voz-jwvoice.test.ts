import { describe, it, expect } from 'vitest'
import {
  analizarHuellaVoz, clasificarRegistroVoz, crearVozJwVoice, serializarJwVoice, leerJwVoice, validarHuellaVoz,
  crearBancoVoces, agregarVozAlBanco, quitarVozDelBanco, asignarPuestoCoro, vozMasCercana,
  serializarBancoVoces, leerBancoVoces, type HuellaVoz,
} from './voz-jwvoice'

const SR = 16000
/** Voz sintética: tren de pulsos glóticos filtrado por 3 resonadores (formantes conocidos). */
function vozSintetica(f0: number, formantes: [number, number, number], seg = 1.5, vibratoCents = 0): Float32Array {
  const n = Math.floor(SR * seg)
  const out = new Float32Array(n)
  const ress = formantes.map((f) => {
    const bw = 90
    const r = Math.exp((-Math.PI * bw) / SR)
    const th = (2 * Math.PI * f) / SR
    return { a1: 2 * r * Math.cos(th), a2: -r * r, y1: 0, y2: 0 }
  })
  let fase = 0
  for (let i = 0; i < n; i++) {
    const f = f0 * Math.pow(2, (vibratoCents * Math.sin((2 * Math.PI * 5 * i) / SR)) / 1200)
    fase += f / SR
    let x = 0
    if (fase >= 1) { fase -= 1; x = 1 }
    let s = 0
    for (const r of ress) {
      const y = x + r.a1 * r.y1 + r.a2 * r.y2
      r.y2 = r.y1; r.y1 = y
      s += y
    }
    out[i] = s * 0.05
  }
  return out
}

const huellaOk: HuellaVoz = { f0MedioHz: 200, f0MinHz: 150, f0MaxHz: 260, formantesHz: [600, 1500, 2500], brillo: 0.4, aspereza: 0.2, sonoridad: 0.8 }

describe('analizarHuellaVoz', () => {
  it('mide f0 y formantes de una vocal sintética', () => {
    const h = analizarHuellaVoz(vozSintetica(200, [700, 1200, 2600]), SR)
    expect(h).not.toBeNull()
    expect(h!.f0MedioHz).toBeGreaterThan(190)
    expect(h!.f0MedioHz).toBeLessThan(210)
    expect(h!.f0MinHz).toBeLessThanOrEqual(h!.f0MedioHz)
    expect(h!.f0MaxHz).toBeGreaterThanOrEqual(h!.f0MedioHz)
    expect(h!.formantesHz[0]).toBeGreaterThan(500)
    expect(h!.formantesHz[0]).toBeLessThan(900)
    expect(h!.formantesHz[1]).toBeGreaterThan(h!.formantesHz[0])
    expect(validarHuellaVoz(h)).toEqual([])
  })
  it('un vibrato ensancha el rango f0 respecto a una voz estable', () => {
    const estable = analizarHuellaVoz(vozSintetica(200, [700, 1200, 2600]), SR)!
    const vib = analizarHuellaVoz(vozSintetica(200, [700, 1200, 2600], 1.5, 80), SR)!
    expect(vib.f0MaxHz - vib.f0MinHz).toBeGreaterThan(estable.f0MaxHz - estable.f0MinHz)
  })
  it('silencio devuelve null (no inventa huella)', () => {
    expect(analizarHuellaVoz(new Float32Array(SR), SR)).toBeNull()
  })
})

describe('registro', () => {
  it('clasifica por f0', () => {
    expect(clasificarRegistroVoz(90)).toBe('bajo')
    expect(clasificarRegistroVoz(130)).toBe('baritono')
    expect(clasificarRegistroVoz(180)).toBe('tenor')
    expect(clasificarRegistroVoz(400)).toBe('soprano')
  })
})

describe('.jwvoice', () => {
  it('ida y vuelta', () => {
    const v = crearVozJwVoice({ id: 'mi-voz', nombre: 'Mi voz lead', huella: huellaOk, creada: '2026-01-01T00:00:00Z' })
    expect(v.registro).toBe('tenor')
    const txt = serializarJwVoice(v)
    expect(JSON.parse(txt).formato).toBe('jwvoice')
    const r = leerJwVoice(txt)
    expect(r.ok && r.voz).toEqual(v)
  })
  it('rechaza formato, versión futura y huellas incoherentes', () => {
    expect(leerJwVoice('no json')).toMatchObject({ ok: false })
    expect(leerJwVoice('{"formato":"otro"}')).toMatchObject({ ok: false })
    const v = crearVozJwVoice({ id: 'a', nombre: 'A', huella: huellaOk })
    expect(leerJwVoice(JSON.stringify({ formato: 'jwvoice', version: 99, voz: v }))).toMatchObject({ ok: false })
    expect(validarHuellaVoz({ ...huellaOk, f0MinHz: 300 }).length).toBeGreaterThan(0)
    expect(validarHuellaVoz({ ...huellaOk, formantesHz: [900, 800, 2500] }).length).toBeGreaterThan(0)
    expect(validarHuellaVoz({ ...huellaOk, brillo: 2 }).length).toBeGreaterThan(0)
    expect(validarHuellaVoz({ ...huellaOk, aspereza: NaN }).length).toBeGreaterThan(0)
    expect(() => serializarJwVoice({ ...v, id: '' })).toThrow()
  })
})

describe('banco de voces', () => {
  const mk = (id: string, f0: number) => crearVozJwVoice({ id, nombre: id, huella: { ...huellaOk, f0MedioHz: f0, f0MinHz: f0 * 0.8, f0MaxHz: f0 * 1.2 } })
  it('agrega, asigna puestos, elige la más cercana y quita', () => {
    let b = crearBancoVoces()
    expect(b.puestos).toHaveLength(4)
    b = agregarVozAlBanco(b, mk('lead', 120))
    b = agregarVozAlBanco(b, mk('soprano', 400))
    b = agregarVozAlBanco(b, mk('lead', 125)) // reemplaza por id
    expect(b.voces).toHaveLength(2)
    b = asignarPuestoCoro(b, 0, { vozId: 'lead' })
    expect(() => asignarPuestoCoro(b, 4, {})).toThrow()
    expect(() => asignarPuestoCoro(b, 1, { vozId: 'nadie' })).toThrow()
    expect(vozMasCercana(b, 380)?.id).toBe('soprano')
    b = quitarVozDelBanco(b, 'lead')
    expect(b.puestos[0].vozId).toBeNull()
  })
  it('serializa y valida el banco', () => {
    let b = agregarVozAlBanco(crearBancoVoces(), mk('lead', 120))
    b = asignarPuestoCoro(b, 0, { vozId: 'lead' })
    const r = leerBancoVoces(serializarBancoVoces(b))
    expect(r.ok && r.banco).toEqual(b)
    const malo = JSON.parse(serializarBancoVoces(b))
    malo.puestos[1].vozId = 'fantasma'
    malo.puestos[2].pan = 5
    expect(leerBancoVoces(JSON.stringify(malo)).ok).toBe(false)
  })
})
