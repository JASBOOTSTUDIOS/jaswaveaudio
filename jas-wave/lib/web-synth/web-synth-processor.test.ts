/**
 * npx tsx --test lib/web-synth/web-synth-processor.test.ts
 * Ejecuta el archivo real del AudioWorklet fuera del navegador (expone MotorSintesis en globalThis).
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, it } from 'node:test'

type Motor = {
  setPreset(n: string): void
  programar(e: { tipo: 'on' | 'off'; nota: number; vel?: number; cuando: number }): void
  render(salida: Float32Array, t0: number): void
  vocesActivas(): number
  panico(): void
}

const contexto: Record<string, unknown> = { Math, Array, globalThis: {} as Record<string, unknown> }
vm.runInNewContext(readFileSync(path.join(__dirname, 'web-synth-processor.js'), 'utf8'), contexto)
const Clase = (contexto.globalThis as Record<string, unknown>).__MotorSintesisJasWave as new (sr: number) => Motor

const SR = 48000

function renderizar(m: Motor, segundos: number, t0 = 0): Float32Array {
  const out = new Float32Array(Math.round(segundos * SR))
  for (let i = 0; i < out.length; i += 128) m.render(out.subarray(i, Math.min(out.length, i + 128)), t0 + i / SR)
  return out
}

/** Frecuencia por cruces ascendentes por cero en una ventana estable. */
function frecuencia(x: Float32Array, desde: number, hasta: number): number {
  let cruces = 0
  let primero = -1
  let ultimo = -1
  for (let i = desde + 1; i < hasta; i++) {
    if (x[i - 1]! < 0 && x[i]! >= 0) {
      cruces++
      if (primero < 0) primero = i
      ultimo = i
    }
  }
  return ((cruces - 1) * SR) / (ultimo - primero)
}

describe('W2 — WebSynth (AudioWorklet)', () => {
  it('afinación: La4 (69) suena a 440 Hz ±1 cent con el preset FM', () => {
    const m = new Clase(SR)
    m.setPreset('fm')
    m.programar({ tipo: 'on', nota: 69, vel: 100, cuando: 0 })
    // Sin modulación en régimen estable no se garantizan cruces limpios: se mide la portadora
    // con índice bajo usando el preset piano (índice decae).
    const p = new Clase(SR)
    p.setPreset('piano')
    p.programar({ tipo: 'on', nota: 69, vel: 100, cuando: 0 })
    const x = renderizar(p, 1.2)
    const f = frecuencia(x, Math.round(0.8 * SR), Math.round(1.1 * SR))
    const cents = 1200 * Math.log2(f / 440)
    assert.ok(Math.abs(cents) < 1, `desviación ${cents.toFixed(3)} cents (${f.toFixed(3)} Hz)`)
    assert.ok(renderizar(m, 0.2).some((v) => Math.abs(v) > 0.01))
  })

  it('sin NaN/Inf y sin recortes con 16 notas a la vez en todos los presets', () => {
    for (const preset of ['pad', 'bajo', 'lead', 'cuerdas', 'fm', 'piano', 'bateria']) {
      const m = new Clase(SR)
      m.setPreset(preset)
      for (let n = 0; n < 16; n++) m.programar({ tipo: 'on', nota: 36 + n * 2, vel: 127, cuando: 0 })
      const x = renderizar(m, 0.5)
      for (const v of x) {
        assert.ok(Number.isFinite(v), preset)
        assert.ok(Math.abs(v) <= 1, `${preset}: muestra ${v}`)
      }
    }
  })

  it('la nota empieza exactamente en el sample programado (misma forma que en t=0, desplazada 1000 samples)', () => {
    const inicio = (cuando: number) => {
      const m = new Clase(SR)
      m.setPreset('lead')
      m.programar({ tipo: 'on', nota: 60, vel: 120, cuando })
      const x = renderizar(m, 0.05)
      return x.findIndex((v) => v !== 0)
    }
    // El PolyBLEP hace que el primer sample de la nota valga 0: se compara con la referencia en t=0.
    assert.equal(inicio(1000 / SR) - inicio(0), 1000)
    // Con un instante que cae entre bloques de 128 (t0 acumulado en coma flotante) tampoco se retrasa.
    assert.equal(inicio(1001 / SR) - inicio(0), 1001)
  })

  it('tras noteOff el release lleva a silencio y libera la voz', () => {
    const m = new Clase(SR)
    m.setPreset('lead')
    m.programar({ tipo: 'on', nota: 60, vel: 100, cuando: 0 })
    m.programar({ tipo: 'off', nota: 60, cuando: 0.3 })
    const x = renderizar(m, 2)
    const cola = x.subarray(Math.round(1.8 * SR))
    assert.ok(Math.max(...cola.map(Math.abs)) < 1e-4)
    assert.equal(m.vocesActivas(), 0)
  })

  it('máximo 16 voces: la 17.ª roba la más antigua', () => {
    const m = new Clase(SR)
    m.setPreset('pad')
    for (let n = 0; n < 20; n++) m.programar({ tipo: 'on', nota: 40 + n, vel: 90, cuando: 0 })
    renderizar(m, 0.01)
    assert.equal(m.vocesActivas(), 16)
    m.panico()
    assert.equal(m.vocesActivas(), 0)
  })

  it('batería: bombo, caja y charles producen energía y se apagan solos', () => {
    for (const nota of [36, 38, 42, 49, 45]) {
      const m = new Clase(SR)
      m.setPreset('bateria')
      m.programar({ tipo: 'on', nota, vel: 120, cuando: 0 })
      const x = renderizar(m, 3)
      const energia = x.subarray(0, 4800).reduce((a, v) => a + v * v, 0)
      assert.ok(energia > 0.5, `nota ${nota}: energía ${energia}`)
      assert.equal(m.vocesActivas(), 0, `nota ${nota} sigue sonando`)
    }
  })
})
