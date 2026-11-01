/**
 * JasWave WebSynth (W2): sintetizador de respaldo para escuchar en la web pistas cuyo instrumento es
 * un VST (que el navegador no puede cargar). Corre en un AudioWorklet.
 *
 * - 16 voces con robo de voz (la más antigua en release, si no la más antigua).
 * - Osciladores PolyBLEP (sin aliasing audible), filtro de estado variable con envolvente, ADSR.
 * - Presets: sustractivo (pad/bajo/lead), FM (2 operadores), piano FM y batería sintética (GM).
 * - Eventos programados al sample: { tipo:'on'|'off', nota, vel, cuando } con `cuando` en tiempo del
 *   AudioContext (currentTime).
 *
 * El motor es una clase pura (MotorSintesis); fuera de un AudioWorklet (pruebas) se expone en
 * globalThis.__MotorSintesisJasWave.
 */

const TAU = Math.PI * 2
const MAX_VOCES = 16

function mtof(n) {
  return 440 * Math.pow(2, (n - 69) / 12)
}

/** Corrección PolyBLEP para discontinuidades (t = fase 0..1, dt = incremento). */
function polyblep(t, dt) {
  if (t < dt) {
    t /= dt
    return t + t - t * t - 1
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt
    return t * t + t + t + 1
  }
  return 0
}

const PRESETS = {
  pad: { modo: 'sub', osc: ['saw', 'saw'], desafino: 0.08, a: 0.35, d: 0.6, s: 0.75, r: 0.9, corte: 1800, res: 0.15, envFiltro: 1200, nivel: 0.16 },
  bajo: { modo: 'sub', osc: ['saw', 'square'], desafino: 0.01, a: 0.004, d: 0.18, s: 0.55, r: 0.08, corte: 650, res: 0.25, envFiltro: 1600, nivel: 0.3 },
  lead: { modo: 'sub', osc: ['saw', 'square'], desafino: 0.05, a: 0.01, d: 0.2, s: 0.7, r: 0.18, corte: 2600, res: 0.3, envFiltro: 2400, nivel: 0.18 },
  cuerdas: { modo: 'sub', osc: ['saw', 'saw'], desafino: 0.12, a: 0.25, d: 0.4, s: 0.85, r: 0.6, corte: 3200, res: 0.1, envFiltro: 600, nivel: 0.14 },
  fm: { modo: 'fm', ratio: 2, indice: 3.5, a: 0.005, d: 0.35, s: 0.4, r: 0.3, nivel: 0.2 },
  piano: { modo: 'fm', ratio: 1, indice: 2.2, a: 0.002, d: 1.4, s: 0.0, r: 0.35, nivel: 0.22, decaeIndice: 2.5 },
  bateria: { modo: 'perc', nivel: 0.5 },
}

class Voz {
  constructor(sr) {
    this.sr = sr
    this.activa = false
  }

  iniciar(nota, vel, p, orden) {
    this.nota = nota
    this.vel = vel / 127
    this.p = p
    this.orden = orden
    this.activa = true
    this.liberada = false
    this.t = 0
    this.env = 0
    this.etapa = 'a'
    this.fases = [0, 0]
    this.faseMod = 0
    this.lp = 0
    this.bp = 0
    this.ruido = 12345 + nota * 977
    this.f = mtof(nota)
  }

  soltar() {
    if (this.activa && !this.liberada) {
      this.liberada = true
      this.etapa = 'r'
    }
  }

  ruidoBlanco() {
    // xorshift32: determinista, barato y sin asignaciones.
    let x = this.ruido
    x ^= x << 13
    x ^= x >>> 17
    x ^= x << 5
    this.ruido = x >>> 0
    return (this.ruido / 4294967296) * 2 - 1
  }

  /** ADSR exponencial; devuelve el nivel actual. */
  envolvente() {
    const p = this.p
    const k = (seg) => 1 - Math.exp(-1 / Math.max(1, seg * this.sr * 0.25))
    switch (this.etapa) {
      case 'a':
        this.env += (1.05 - this.env) * k(p.a)
        if (this.env >= 1) {
          this.env = 1
          this.etapa = 'd'
        }
        break
      case 'd':
        this.env += (p.s - this.env) * k(p.d)
        if (Math.abs(this.env - p.s) < 1e-4) this.etapa = 's'
        break
      case 's':
        this.env = p.s
        if (p.s <= 0) this.activa = false
        break
      case 'r':
        this.env += (0 - this.env) * k(p.r)
        if (this.env < 1e-5) this.activa = false
        break
    }
    return this.env
  }

  muestraSub() {
    const p = this.p
    let s = 0
    for (let i = 0; i < 2; i++) {
      const f = this.f * (i === 0 ? 1 : 1 + p.desafino / 12)
      const dt = f / this.sr
      let t = this.fases[i]
      let v
      if (p.osc[i] === 'square') {
        v = t < 0.5 ? 1 : -1
        v += polyblep(t, dt)
        v -= polyblep((t + 0.5) % 1, dt)
      } else {
        v = 2 * t - 1 - polyblep(t, dt)
      }
      t += dt
      if (t >= 1) t -= 1
      this.fases[i] = t
      s += v * 0.5
    }
    // Filtro de estado variable (Chamberlin) con envolvente.
    const env = this.env
    const corte = Math.min(this.sr * 0.2, p.corte + p.envFiltro * env * this.vel)
    const fc = 2 * Math.sin((Math.PI * corte) / this.sr)
    const q = 1 - p.res * 0.9
    const hp = s - this.lp - q * this.bp
    this.bp += fc * hp
    this.lp += fc * this.bp
    return this.lp
  }

  muestraFm() {
    const p = this.p
    const tiempo = this.t / this.sr
    const indice = p.indice * (p.decaeIndice ? Math.exp(-tiempo * p.decaeIndice) : 1) * (0.5 + this.vel * 0.5)
    const mod = Math.sin(TAU * this.faseMod) * indice
    const v = Math.sin(TAU * this.fases[0] + mod)
    this.fases[0] = (this.fases[0] + this.f / this.sr) % 1
    this.faseMod = (this.faseMod + (this.f * p.ratio) / this.sr) % 1
    return v
  }

  /** Batería sintética por nota GM: bombo, caja, charles, toms y platos. */
  muestraPerc() {
    const tiempo = this.t / this.sr
    const n = this.nota
    let v = 0
    if (n === 35 || n === 36) {
      const f = 48 + 120 * Math.exp(-tiempo * 28)
      this.fases[0] = (this.fases[0] + f / this.sr) % 1
      v = Math.sin(TAU * this.fases[0]) * Math.exp(-tiempo * 7)
    } else if (n === 38 || n === 40 || n === 37 || n === 39) {
      this.fases[0] = (this.fases[0] + 185 / this.sr) % 1
      v = Math.sin(TAU * this.fases[0]) * Math.exp(-tiempo * 22) * 0.6 + this.ruidoBlanco() * Math.exp(-tiempo * 16) * 0.55
    } else if (n === 42 || n === 44 || n === 46) {
      const decae = n === 46 ? 6 : 38
      const r = this.ruidoBlanco()
      const hp = r - this.lp
      this.lp += 0.5 * hp
      v = hp * Math.exp(-tiempo * decae) * 0.45
    } else if (n === 49 || n === 51 || n === 52 || n === 55 || n === 57 || n === 59) {
      const r = this.ruidoBlanco()
      const hp = r - this.lp
      this.lp += 0.35 * hp
      v = hp * Math.exp(-tiempo * (n === 51 || n === 59 ? 3 : 1.6)) * 0.35
    } else {
      // Toms (41–50) y resto: seno con barrido según la nota.
      const base = 70 + (n - 41) * 18
      const f = base * (1 + 0.6 * Math.exp(-tiempo * 18))
      this.fases[0] = (this.fases[0] + f / this.sr) % 1
      v = Math.sin(TAU * this.fases[0]) * Math.exp(-tiempo * 9)
    }
    if (tiempo > 2.5 || (tiempo > 0.05 && Math.abs(v) < 1e-5)) this.activa = false
    return v * this.vel
  }

  muestra() {
    let v
    if (this.p.modo === 'perc') v = this.muestraPerc()
    else {
      const env = this.envolvente()
      v = (this.p.modo === 'fm' ? this.muestraFm() : this.muestraSub()) * env * (0.35 + this.vel * 0.65)
    }
    this.t++
    return v * this.p.nivel
  }
}

class MotorSintesis {
  constructor(sampleRate) {
    this.sr = sampleRate
    this.voces = Array.from({ length: MAX_VOCES }, () => new Voz(sampleRate))
    this.preset = PRESETS.pad
    this.eventos = []
    this.orden = 0
  }

  setPreset(nombre) {
    this.preset = PRESETS[nombre] || PRESETS.pad
  }

  programar(evento) {
    // Inserción ordenada por tiempo (la cola es corta: lookahead < 1 s).
    let i = this.eventos.length
    while (i > 0 && this.eventos[i - 1].cuando > evento.cuando) i--
    this.eventos.splice(i, 0, evento)
  }

  panico() {
    this.eventos.length = 0
    for (const v of this.voces) v.activa = false
  }

  vocesActivas() {
    let n = 0
    for (const v of this.voces) if (v.activa) n++
    return n
  }

  aplicar(e) {
    if (e.tipo === 'off') {
      for (const v of this.voces) if (v.activa && v.nota === e.nota && !v.liberada) v.soltar()
      return
    }
    let libre = this.voces.find((v) => !v.activa)
    if (!libre) {
      // Robo de voz: primero la más antigua ya liberada; si no, la más antigua.
      const liberadas = this.voces.filter((v) => v.liberada)
      const candidatas = liberadas.length ? liberadas : this.voces
      libre = candidatas.reduce((a, b) => (a.orden <= b.orden ? a : b))
    }
    libre.iniciar(e.nota, e.vel, this.preset, this.orden++)
  }

  /** Rellena `salida` (mono) a partir del instante `tiempo0` (segundos del AudioContext). */
  render(salida, tiempo0) {
    const dt = 1 / this.sr
    for (let i = 0; i < salida.length; i++) {
      const ahora = tiempo0 + i * dt
      // Media muestra de margen: el instante acumulado en coma flotante no debe retrasar un sample.
      while (this.eventos.length && this.eventos[0].cuando <= ahora + dt * 0.5) this.aplicar(this.eventos.shift())
      let s = 0
      for (const v of this.voces) if (v.activa) s += v.muestra()
      // Saturación suave: evita recortes duros con muchas voces.
      salida[i] = Math.tanh(s)
    }
  }
}

if (typeof registerProcessor === 'function') {
  class ProcesadorWebSynth extends AudioWorkletProcessor {
    constructor() {
      super()
      this.motor = new MotorSintesis(sampleRate)
      this.port.onmessage = (e) => {
        const m = e.data
        if (m.tipo === 'preset') this.motor.setPreset(m.preset)
        else if (m.tipo === 'panico') this.motor.panico()
        else if (m.tipo === 'on' || m.tipo === 'off') this.motor.programar(m)
      }
    }
    process(_entradas, salidas) {
      const salida = salidas[0]
      if (!salida || !salida[0]) return true
      this.motor.render(salida[0], currentTime)
      for (let c = 1; c < salida.length; c++) salida[c].set(salida[0])
      return true
    }
  }
  registerProcessor('jaswave-websynth', ProcesadorWebSynth)
} else {
  globalThis.__MotorSintesisJasWave = MotorSintesis
  globalThis.__PresetsWebSynthJasWave = PRESETS
}
