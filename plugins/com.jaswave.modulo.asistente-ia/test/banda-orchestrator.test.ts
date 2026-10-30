/**
 * npx tsx --tsconfig ../sdk/host-sdk/pruebas/tsconfig.pruebas.json --test test/banda-orchestrator.test.ts
 *
 * La banda corre en la ventana principal; su panel puede estar en una ventana flotante (otro renderer).
 * El estado viaja por un canal entre ventanas y el panel flotante lo refleja (antes se veía vacío).
 */
import '../../sdk/host-sdk/pruebas/instalar'
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { BandaOrchestrator } from '../src/motor/banda-orchestrator'

type Msg = { tipo: string; state?: unknown }
type Canal = { postMessage: (m: Msg) => void; onmessage: ((ev: { data: unknown }) => void) | null }

/** Dos extremos de un canal en memoria: lo que uno manda lo recibe el otro (como BroadcastChannel). */
function parDeCanales(): [Canal, Canal, Msg[]] {
  const enviados: Msg[] = []
  const a: Canal = { onmessage: null, postMessage: (m) => { enviados.push(m); b.onmessage?.({ data: m }) } }
  const b: Canal = { onmessage: null, postMessage: (m) => { enviados.push(m); a.onmessage?.({ data: m }) } }
  return [a, b, enviados]
}

const participantes = [
  { id: 'dir', nombre: 'Director', descripcion: '', instrucciones: '', rol: 'director' as const },
  { id: 'bat', nombre: 'Baterista', descripcion: '', instrucciones: '', rol: 'musico' as const },
]

describe('banda en ventana flotante (reflejo entre ventanas)', () => {
  it('la ventana principal publica cada cambio y la flotante lo refleja', () => {
    const [a, b] = parDeCanales()
    const principal = new BandaOrchestrator(a)
    const flotante = new BandaOrchestrator(b)
    const visto: unknown[] = []
    flotante.subscribe((s) => visto.push(s.faseActual))

    let detenida = false
    principal.comenzar('una balada', participantes, () => { detenida = true })
    principal.evento({ tipo: 'etapa', etapa: 'musicos', fase: 'inicio' })

    assert.equal(flotante.esReflejo(), true)
    assert.equal(flotante.getState().activo, true)
    assert.equal(flotante.getState().faseActual, 'grabacion_musicos')
    assert.equal(flotante.getState().eventos.length, principal.getState().eventos.length)
    assert.ok(visto.includes('grabacion_musicos'))

    // «Detener» desde la flotante llega a la ventana que lleva la producción.
    flotante.detener()
    assert.equal(detenida, true)
  })

  it('un estado reflejado sin «participantes» (otra versión o un emisor ajeno) no deja huecos que tumben el panel', () => {
    const [a, b] = parDeCanales()
    const flotante = new BandaOrchestrator(b)
    a.postMessage({
      tipo: 'estado',
      state: {
        activo: true,
        faseActual: 'grabacion_musicos',
        promptUsuario: 'E2E',
        agenteActivoId: 'bat',
        eventos: [{ id: 'e1', timestamp: 1, fase: 'grabacion_musicos', agenteId: 'bat', agenteNombre: 'Baterista', rol: 'musico', mensaje: 'Grabando' }],
        qaReporte: { musicosAprobados: 0, musicosTotal: 1, mezclaAprobada: false, masterAprobado: false, rondas: 0, detalles: [] },
      },
    })
    assert.equal(flotante.esReflejo(), true)
    assert.deepEqual(flotante.getState().participantes, [])
    assert.equal(flotante.getState().eventos.length, 1)
    assert.equal(flotante.getState().faseActual, 'grabacion_musicos')
    // Y si ni siquiera trae eventos, tampoco rompe.
    a.postMessage({ tipo: 'estado', state: { activo: false, faseActual: 'idle' } })
    assert.deepEqual(flotante.getState().eventos, [])
    assert.deepEqual(flotante.getState().participantes, [])
  })

  it('una ventana flotante que se abre a mitad de la producción pide el estado y lo recibe', () => {
    const [a, b] = parDeCanales()
    const principal = new BandaOrchestrator(a)
    principal.comenzar('tema', participantes, () => {})
    principal.evento({ tipo: 'etapa', etapa: 'mezcla', fase: 'inicio' })
    // La flotante nace después: su «pedir» se responde con el estado actual.
    const flotante = new BandaOrchestrator(b)
    assert.equal(flotante.getState().faseActual, 'mezcla')
    assert.equal(flotante.getState().promptUsuario, 'tema')
  })

  it('una producción propia nunca se pisa con el reflejo de otra ventana', () => {
    const [a, b] = parDeCanales()
    const principal = new BandaOrchestrator(a)
    const otra = new BandaOrchestrator(b)
    principal.comenzar('mía', participantes, () => {})
    otra.comenzar('la otra', participantes, () => {})
    principal.evento({ tipo: 'etapa', etapa: 'mezcla', fase: 'inicio' })
    assert.equal(otra.getState().promptUsuario, 'la otra')
    assert.equal(otra.esReflejo(), false)
  })
})

describe('escribirle a la banda mientras trabaja', () => {
  const fin = { estado: 'completado' as const, plan: '', etapas: [], encargos: [], llamadas: [], texto: '' }

  it('una indicación queda en la consola como «Tú» y la producción la recoge una sola vez', () => {
    const o = new BandaOrchestrator(null)
    o.comenzar('tema', participantes, () => {})
    o.evento({ tipo: 'etapa', etapa: 'musicos', fase: 'inicio' })
    assert.equal(o.enviarNota('  el bombo   suena tarde '), true)
    const ultimo = o.getState().eventos.at(-1)!
    assert.equal(ultimo.agenteNombre, 'Tú')
    assert.equal(ultimo.mensaje, 'el bombo suena tarde')
    // La línea del usuario no cambia quién está trabajando ni la fase.
    assert.equal(o.getState().faseActual, 'grabacion_musicos')
    assert.deepEqual(o.tomarNotas(), [{ texto: 'el bombo suena tarde' }])
    assert.deepEqual(o.tomarNotas(), [])
  })

  it('dirigida a un participante: por selector o con «@Nombre …» / «Nombre: …» en el chat', () => {
    const o = new BandaOrchestrator(null)
    o.comenzar('tema', participantes, () => {})
    assert.deepEqual(o.getState().participantes.map((p) => p.id), ['dir', 'bat'])
    assert.deepEqual(o.destinatarioDeTexto('@Baterista más suave'), { texto: 'más suave', para: 'bat' })
    assert.deepEqual(o.destinatarioDeTexto('baterista: más suave'), { texto: 'más suave', para: 'bat' })
    assert.deepEqual(o.destinatarioDeTexto('Oye, más suave'), { texto: 'Oye, más suave' })
    assert.equal(o.enviarNota('más suave', 'bat'), true)
    assert.equal(o.enviarNota('x', 'nadie'), false)
    assert.match(o.getState().eventos.at(-1)!.mensaje, /^Para Baterista: más suave$/)
    assert.deepEqual(o.tomarNotas(), [{ texto: 'más suave', para: 'bat' }])
  })

  it('sin producción en curso no se acepta; al terminar se vacía lo pendiente', () => {
    const o = new BandaOrchestrator(null)
    assert.equal(o.enviarNota('hola'), false)
    o.comenzar('tema', participantes, () => {})
    assert.equal(o.enviarNota('a'), true)
    o.terminar(fin)
    assert.deepEqual(o.tomarNotas(), [])
    assert.equal(o.enviarNota('b'), false)
  })

  it('desde el panel flotante viaja a la ventana que lleva la producción, y «la tiene en cuenta» vuelve reflejado', () => {
    const [a, b] = parDeCanales()
    const principal = new BandaOrchestrator(a)
    const flotante = new BandaOrchestrator(b)
    principal.comenzar('tema', participantes, () => {})
    assert.equal(flotante.enviarNota('más grave', 'bat'), true)
    assert.deepEqual(principal.tomarNotas(), [{ texto: 'más grave', para: 'bat' }])
    assert.equal(flotante.getState().eventos.at(-1)!.agenteNombre, 'Tú')
    principal.evento({ tipo: 'nota', etapa: 'musicos', participante: { id: 'bat', nombre: 'Baterista', rol: 'musico' }, texto: 'más grave' })
    assert.match(flotante.getState().eventos.at(-1)!.mensaje, /Tiene en cuenta tu indicación: «más grave»/)
  })
})
