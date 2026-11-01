/**
 * Mezcla inicial determinista de la banda (plan T) sobre una tienda real: comandos con undo, idempotencia, perfiles
 * de estilo, sin medición y máster mínimo con el objetivo del perfil.
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { crearEstadoInicial, crearTiendaDAW, PERFILES_MEZCLA, validarPerfilMezcla } from '../../../shared/src/index'
import { aplicarAutomezcla, nuevaMemoriaAutomezcla, revertirAutomezcla, type EjecutarMezcla, type MedicionAutomezcla } from '../src/motor/turno/automezcla-banda'
import { masterMinimoDeterminista } from '../src/motor/turno/master-minimo'
import { elegirPerfilDeProduccion, jsonDelDocumento, plantillaPerfilUsuario } from '../src/motor/turno/perfiles-mezcla-usuario'

const db = (x: number) => 10 * Math.log10(x)
const bandas = (reparto: number[], rms: number) => reparto.map((f) => (f > 0 ? db(f) + rms : -120))

const STEMS: Array<[string, number, number[]]> = [
  ['Batería', -11, [0.15, 0.55, 0.1, 0.1, 0.08, 0.02]],
  ['Bajo', -10, [0.35, 0.6, 0.03, 0.01, 0.01, 0]],
  ['Piano', -18, [0.04, 0.55, 0.2, 0.15, 0.05, 0.01]],
  ['Guitarra', -19, [0.03, 0.5, 0.22, 0.17, 0.07, 0.01]],
  ['Pad', -12, [0.25, 0.68, 0.04, 0.02, 0.01, 0]],
]

async function proyecto() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() })
  for (const [nombre] of STEMS) {
    await tienda.executor.execute('track.create', { nombre, tipo: 'midi' }, 'user')
    const id = tienda.obtenerEstado().project.tracks.find((t) => t.nombre === nombre)!.id
    await tienda.executor.execute('midi.clip.create', { pistaId: id, nombre: 'A', inicio: 0, duracion: 16, notas: [{ pitch: 48, inicio: 0, duracion: 1, velocidad: 90 }] }, 'user')
    await tienda.executor.execute('track.update', { trackId: id, datos: { volumen: 1 } }, 'user')
  }
  return tienda
}

const medicionDe = (tienda: Awaited<ReturnType<typeof proyecto>>): MedicionAutomezcla => ({
  pistas: tienda.obtenerEstado().project.tracks.map((t) => {
    const s = STEMS.find((x) => x[0] === t.nombre)!
    return { trackId: t.id, rmsDb: s[1] + 20 * Math.log10(Number(t.volumen ?? 1)), bandasDb: bandas(s[2], s[1]) }
  }),
})

/** Ejecutor: los comandos de la tienda van a la tienda real; mix.eq y plugin.insert (host de audio) se anotan. */
function ejecutor(tienda: Awaited<ReturnType<typeof proyecto>>) {
  const log: Array<{ nombre: string; args: Record<string, unknown> }> = []
  const ejecutar: EjecutarMezcla = async (nombre, args) => {
    log.push({ nombre, args })
    if (nombre === 'mix.eq' || nombre === 'plugin.insert') return { ok: true }
    const r = await tienda.executor.execute(nombre, args, 'ai')
    return { ok: Boolean(r.success), mensaje: (r as { error?: { message?: string } }).error?.message, datos: r.result }
  }
  return { ejecutar, log }
}

const HOJA = { secciones: [{ nombre: 'Verso', compases: 8 }, { nombre: 'Coro', compases: 8 }], bpm: 100, numerador: 4 }
const vol = (tienda: Awaited<ReturnType<typeof proyecto>>, nombre: string) => Number(tienda.obtenerEstado().project.tracks.find((t) => t.nombre === nombre)!.volumen)

describe('aplicarAutomezcla', () => {
  it('aplica ganancias, pasa-altos, paneo, curvas por sección y reverb con comandos reales', async () => {
    const tienda = await proyecto()
    const { ejecutar, log } = ejecutor(tienda)
    const memoria = nuevaMemoriaAutomezcla()
    const r = await aplicarAutomezcla({ tienda, ejecutar, memoria, medir: async () => medicionDe(tienda), hoja: HOJA })
    assert.equal(r.ok, true, r.resumen)
    assert.equal(r.aplicada, true)
    assert.equal(r.medido, true)
    const plan = r.plan!
    assert.ok(plan.picoSumaDb < -3, `pico ${plan.picoSumaDb}`)
    assert.ok(plan.sumaRmsDb <= -17.9 && plan.sumaRmsDb >= -19.5, `rms ${plan.sumaRmsDb}`)
    // Con solo 5 stems muy cargados de graves el objetivo puede no alcanzarse: debe mejorar mucho y, si no cumple, avisarlo.
    assert.ok(plan.espectroDespues.graves < plan.espectroAntes!.graves - 0.2, `graves ${plan.espectroDespues.graves}`)
    if (!plan.cumple.graves) assert.match(plan.notas.join(' '), /Aviso/)
    assert.ok(plan.espectroAntes!.graves > 0.75)
    // Los faders del proyecto coinciden con el plan
    for (const p of plan.pistas) assert.ok(Math.abs(vol(tienda, p.nombre) - p.volumen) < 0.002, p.nombre)
    // Paneo: piano y guitarra a lados opuestos; batería y bajo al centro
    const pan = (n: string) => Number(tienda.obtenerEstado().project.tracks.find((t) => t.nombre === n)!.paneo ?? 0)
    assert.equal(pan('Batería'), 0)
    assert.equal(pan('Bajo'), 0)
    assert.equal(Math.sign(pan('Piano')), -Math.sign(pan('Guitarra')))
    // EQ: pasa-altos en piano, guitarra y pad; ninguno en bajo ni batería
    const idDe = (n: string) => tienda.obtenerEstado().project.tracks.find((t) => t.nombre === n)!.id
    const hpf = (n: string) => log.some((l) => l.nombre === 'mix.eq' && l.args.trackId === idDe(n) && l.args.banda === 1 && l.args.tipo === 'lowCut')
    assert.ok(hpf('Piano') && hpf('Guitarra') && hpf('Pad'))
    assert.ok(!hpf('Bajo') && !hpf('Batería'))
    // Curva de volumen por sección en cada pista: el coro ~3 dB sobre el verso
    const lanes = tienda.obtenerEstado().project.tracks.find((t) => t.nombre === 'Piano')!.automatizaciones ?? []
    const lane = lanes.find((a) => a.parametro === 'volumen')!
    assert.ok(lane, 'curva de volumen')
    assert.equal(lane.puntos.length, 4)
    assert.ok(Math.abs(20 * Math.log10(lane.puntos[2]!.valor / lane.puntos[0]!.valor) - 3) < 0.3)
    // Reverb: bus «Reverb corta» con su plugin y envíos solo a instrumentos melódicos
    const bus = tienda.obtenerEstado().project.tracks.find((t) => t.tipo === 'bus' && t.nombre === 'Reverb corta')
    assert.ok(bus)
    assert.ok(log.some((l) => l.nombre === 'plugin.insert' && l.args.trackId === bus!.id))
    const envios = log.filter((l) => l.nombre === 'send.set')
    assert.ok(envios.length >= 3)
    assert.ok(!envios.some((e) => e.args.trackId === idDe('Bajo') || e.args.trackId === idDe('Batería')))
    assert.match(r.resumen, /Mezcla inicial determinista/)
    assert.equal(r.perfil, 'Worship moderno')
  })

  it('es idempotente: aplicarla dos veces no cambia nada más', async () => {
    const tienda = await proyecto()
    const { ejecutar, log } = ejecutor(tienda)
    const memoria = nuevaMemoriaAutomezcla()
    const opts = { tienda, ejecutar, memoria, medir: async () => medicionDe(tienda), hoja: HOJA }
    const a = await aplicarAutomezcla(opts)
    const estadoA = JSON.stringify(tienda.obtenerEstado().project.tracks.map((t) => [t.id, t.volumen, t.paneo]))
    const llamadas = log.length
    const b = await aplicarAutomezcla(opts)
    assert.equal(b.aplicada, false)
    assert.equal(b.cambios, 0)
    assert.equal(log.length, llamadas)
    assert.equal(JSON.stringify(tienda.obtenerEstado().project.tracks.map((t) => [t.id, t.volumen, t.paneo])), estadoA)
    assert.ok(a.cambios > 0)
  })

  it('sin medición (la medición agota su tiempo) usa valores por rol, avisa y sigue', async () => {
    const tienda = await proyecto()
    const { ejecutar } = ejecutor(tienda)
    const t0 = Date.now()
    const r = await aplicarAutomezcla({ tienda, ejecutar, memoria: nuevaMemoriaAutomezcla(), medir: () => new Promise(() => undefined), maxMsMedicion: 30 })
    assert.ok(Date.now() - t0 < 2000)
    assert.equal(r.aplicada, true)
    assert.equal(r.medido, false)
    assert.ok(r.plan!.pistas.every((p) => p.origen === 'rol'))
    assert.match(r.notas.join(' '), /tardó demasiado o falló/)
    assert.ok(r.plan!.picoSumaDb < -3)
  })

  it('medición que falla: también sigue; sin función de medición: valores por rol', async () => {
    const tienda = await proyecto()
    const { ejecutar } = ejecutor(tienda)
    const r1 = await aplicarAutomezcla({ tienda, ejecutar, memoria: nuevaMemoriaAutomezcla(), medir: async () => { throw new Error('host caído') } })
    assert.equal(r1.aplicada, true)
    const t2 = await proyecto()
    const r2 = await aplicarAutomezcla({ tienda: t2, ejecutar: ejecutor(t2).ejecutar, memoria: nuevaMemoriaAutomezcla() })
    assert.equal(r2.aplicada, true)
    assert.equal(r2.medido, false)
  })

  it('no toca pistas silenciadas ni la automatización de volumen del usuario', async () => {
    const tienda = await proyecto()
    const piano = tienda.obtenerEstado().project.tracks.find((t) => t.nombre === 'Piano')!.id
    const pad = tienda.obtenerEstado().project.tracks.find((t) => t.nombre === 'Pad')!.id
    await tienda.executor.execute('track.update', { trackId: pad, datos: { silenciada: true } }, 'user')
    await tienda.executor.execute('automation.setCurve', { trackId: piano, parametro: 'volumen', puntos: [{ tiempo: 0, valor: 0.5 }, { tiempo: 10, valor: 0.9 }] }, 'user')
    const r = await aplicarAutomezcla({ tienda, ejecutar: ejecutor(tienda).ejecutar, memoria: nuevaMemoriaAutomezcla(), hoja: HOJA })
    assert.equal(vol(tienda, 'Pad'), 1)
    assert.match(r.notas.join(' '), /«Pad» está silenciada/)
    assert.match(r.notas.join(' '), /«Piano» ya tiene automatización de volumen/)
    const lane = tienda.obtenerEstado().project.tracks.find((t) => t.id === piano)!.automatizaciones!.find((a) => a.parametro === 'volumen')!
    assert.equal(lane.puntos.length, 2)
  })

  it('es reversible: revertir devuelve fader y paneo originales y quita bandas, curvas y envíos', async () => {
    const tienda = await proyecto()
    const { ejecutar, log } = ejecutor(tienda)
    const memoria = nuevaMemoriaAutomezcla()
    await aplicarAutomezcla({ tienda, ejecutar, memoria, medir: async () => medicionDe(tienda), hoja: HOJA })
    assert.notEqual(vol(tienda, 'Bajo'), 1)
    const rev = await revertirAutomezcla(ejecutar, memoria)
    assert.equal(rev.ok, true)
    for (const [n] of STEMS) assert.equal(vol(tienda, n), 1)
    assert.ok(log.some((l) => l.nombre === 'mix.eq' && l.args.accion === 'quitarBanda'))
    assert.ok(tienda.obtenerEstado().project.tracks.every((t) => !(t.automatizaciones ?? []).some((a) => a.parametro === 'volumen' && a.puntos.length)))
    // Y se puede volver a aplicar
    const otra = await aplicarAutomezcla({ tienda, ejecutar, memoria, medir: async () => medicionDe(tienda), hoja: HOJA })
    assert.equal(otra.aplicada, true)
  })

  it('el perfil de estilo cambia la mezcla y el modelo recibe el guion del perfil', async () => {
    const resultados: Record<string, { vols: number[]; guion: string; master: { lufs: number } }> = {}
    for (const id of ['worship-moderno', 'rock', 'jazz']) {
      const tienda = await proyecto()
      const perfil = PERFILES_MEZCLA.find((p) => p.id === id)!
      const r = await aplicarAutomezcla({ tienda, ejecutar: ejecutor(tienda).ejecutar, memoria: nuevaMemoriaAutomezcla(), perfil, medir: async () => medicionDe(tienda), hoja: HOJA })
      resultados[id] = { vols: STEMS.map(([n]) => vol(tienda, n)), guion: r.guion!, master: r.plan!.perfil.master }
      assert.ok(r.plan!.picoSumaDb < -3)
    }
    assert.notDeepEqual(resultados['rock']!.vols, resultados['worship-moderno']!.vols)
    assert.notDeepEqual(resultados['jazz']!.vols, resultados['rock']!.vols)
    assert.match(resultados['rock']!.guion, /Perfil «Rock»/)
    assert.equal(resultados['rock']!.master.lufs, -12)
    assert.equal(resultados['jazz']!.master.lufs, -16)
  })
})

describe('máster mínimo tras la mezcla inicial', () => {
  it('por defecto deja −14 LUFS y −1 dBTP; con el perfil, su objetivo', async () => {
    const llamadas: Array<[string, Record<string, unknown>]> = []
    const ej: EjecutarMezcla = async (n, a) => {
      llamadas.push([n, a])
      return { ok: true }
    }
    await masterMinimoDeterminista(ej)
    assert.deepEqual(llamadas[0], ['master.normalizar', { objetivoLufs: -14 }])
    assert.equal(llamadas[1]![0], 'mix.limit')
    assert.equal(llamadas[1]![1].ceiling, -1)
    llamadas.length = 0
    await masterMinimoDeterminista(ej, undefined, { lufs: -12, picoDbtp: -1 })
    assert.deepEqual(llamadas[0], ['master.normalizar', { objetivoLufs: -12 }])
  })
})

describe('perfiles del productor', () => {
  it('la plantilla es un documento editable que se valida y se elige por nombre', () => {
    const md = plantillaPerfilUsuario('rock', 'mi-rock', 'Mi rock')
    const json = jsonDelDocumento(md.split('\n').slice(3).join('\n')) as { id: string; base: string }
    assert.equal(json.id, 'mi-rock')
    assert.equal(json.base, 'rock')
    const v = validarPerfilMezcla({ ...json, nivelDb: { guitarra: -2 } })
    assert.equal(v.ok, true)
  })

  it('orden de elección: hoja de ruta > pedido > respaldo (sin ajuste del productor)', () => {
    assert.equal(elegirPerfilDeProduccion({ estiloHoja: 'rock', pedido: 'worship' }).perfil.id, 'rock')
    assert.equal(elegirPerfilDeProduccion({ pedido: 'una balada lenta' }).perfil.id, 'balada')
    assert.equal(elegirPerfilDeProduccion({ pedido: 'algo' }).origen, 'defecto')
  })
})
