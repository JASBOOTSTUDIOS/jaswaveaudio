import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RelojHostMidi } from './midi-clock-sync'
import {
  BufferEscuchaMidi,
  CC_ESCUCHADOS,
  analizarEjemploMidi,
  controlDeEventos,
  notasDeEventos,
  resumenToma,
  type EventoEscucha,
  type NotaEscuchada,
} from './midi-example-analyzer'

const ms = (x: number) => x * 1e6

test('reloj: el retraso variable del transporte no mueve el instante del evento', () => {
  const reloj = new RelojHostMidi()
  // Host a 1000 s; el renderer va 5000 ms por delante y cada evento tarda 2–40 ms en llegar.
  const retrasos = [12, 2, 40, 7, 25, 3]
  const mapeados = retrasos.map((r, i) => {
    const hostMs = 1_000_000 + i * 100
    return reloj.mapear(ms(hostMs), hostMs + 5000 + r) - (hostMs + 5000)
  })
  // Tras ver el retraso mínimo (2 ms), el error queda en ese mínimo (no en el retraso de cada evento).
  for (const err of mapeados.slice(1)) assert.ok(err >= 0 && err <= 2.2, `error ${err}`)
})

test('reloj: nunca devuelve un instante futuro y se reinicia tras una pausa larga', () => {
  const reloj = new RelojHostMidi()
  assert.equal(reloj.mapear(ms(10), 500), 500)
  // Pausa de 2 min y relojes distintos: se reestima en lugar de arrastrar el desfase viejo.
  const t = reloj.mapear(ms(10_000), 500 + 120_000)
  assert.equal(t, 500 + 120_000)
})

test('notas: empareja on/off por canal y pitch; velocity 0 es off', () => {
  const ev: EventoEscucha[] = [
    { tNs: ms(0), tipo: 'on', pitch: 60, velocity: 100, canal: 0 },
    { tNs: ms(10), tipo: 'on', pitch: 64, velocity: 90, canal: 0 },
    { tNs: ms(500), tipo: 'on', pitch: 60, velocity: 0, canal: 0 },
    { tNs: ms(600), tipo: 'off', pitch: 64, velocity: 0, canal: 0 },
  ]
  const n = notasDeEventos(ev)
  assert.deepEqual(
    n.map((x) => [x.pitch, x.inicioMs, x.duracionMs]),
    [
      [60, 0, 500],
      [64, 10, 590],
    ],
  )
})

test('búfer: guarda los últimos segundos', () => {
  const b = new BufferEscuchaMidi()
  for (let i = 0; i < 10; i++) b.push({ tNs: i * 1e9, tipo: 'on', pitch: 60, velocity: 100, canal: 0 })
  assert.equal(b.ultimos(3).length, 4) // 6, 7, 8, 9 s
})

test('notas: ignora CC y pitch bend; una nota sin off dura hasta el último evento (aunque sea un CC)', () => {
  const ev: EventoEscucha[] = [
    { tNs: ms(0), tipo: 'cc', cc: 64, valor: 127, canal: 0, deviceId: 'psr' },
    { tNs: ms(5), tipo: 'on', pitch: 60, velocity: 100, canal: 0, deviceId: 'psr' },
    { tNs: ms(300), tipo: 'bend', valor: 0.5, canal: 0 },
    { tNs: ms(900), tipo: 'cc', cc: 64, valor: 0, canal: 0 },
  ]
  const n = notasDeEventos(ev)
  assert.deepEqual(n.map((x) => [x.pitch, x.inicioMs, x.duracionMs]), [[60, 5, 895]])
  assert.deepEqual(controlDeEventos(ev, 64), [
    { tMs: 0, valor: 127 },
    { tMs: 900, valor: 0 },
  ])
  assert.equal(CC_ESCUCHADOS.includes(64) && CC_ESCUCHADOS.includes(67) && CC_ESCUCHADOS.includes(1), true)
})

test('toma: acumula lo tocado desde iniciar hasta terminar, con el transporte, sin romper ultimos()', () => {
  const b = new BufferEscuchaMidi()
  b.push({ tNs: ms(0), tipo: 'on', pitch: 48, velocity: 80, canal: 0 })
  assert.equal(b.tomaActual(), null)
  assert.equal(b.tomaEnCurso, false)
  const t = b.iniciarToma({ ahoraNs: ms(1000), transporte: { reproduciendo: true, posicionBeats: 8, bpm: 92 } })
  assert.equal(b.tomaEnCurso, true)
  assert.equal(t.transporte?.bpm, 92)
  assert.equal(t.transporte?.posicionBeats, 8)
  b.push({ tNs: ms(1100), tipo: 'on', pitch: 60, velocity: 100, canal: 0, deviceId: 'psr' })
  b.push({ tNs: ms(1100), tipo: 'cc', cc: 64, valor: 127, canal: 0, deviceId: 'psr' })
  b.push({ tNs: ms(1600), tipo: 'off', pitch: 60, velocity: 0, canal: 0, deviceId: 'psr' })
  // Un evento con sello anterior al inicio (retraso de reloj) no entra en la toma.
  b.push({ tNs: ms(900), tipo: 'on', pitch: 50, velocity: 90, canal: 0 })
  const fin = b.terminarToma(ms(2000))
  assert.ok(fin)
  assert.equal(fin!.id, t.id)
  assert.equal(fin!.finNs, ms(2000))
  assert.equal(fin!.eventos.length, 3)
  assert.equal(b.tomaEnCurso, false)
  assert.equal(b.tomaActual()?.id, t.id, 'la última toma sigue disponible tras terminar')
  assert.equal(b.terminarToma(ms(2500)), null, 'terminar dos veces no hace nada')
  // Lo que llega después ya no entra en la toma pero sí en el anillo.
  b.push({ tNs: ms(2100), tipo: 'on', pitch: 62, velocity: 100, canal: 0 })
  assert.equal(b.tomaActual()!.eventos.length, 3)
  assert.equal(b.ultimos(3, ms(2100)).length, 6)
  const r = resumenToma(b.tomaActual())
  assert.deepEqual(r, { enCurso: false, segundos: 1, notas: 1, pedal: 1, controles: 0 })
  // Iniciar otra cierra la anterior y empieza de cero.
  const t2 = b.iniciarToma({ ahoraNs: ms(3000) })
  assert.notEqual(t2.id, t.id)
  assert.equal(t2.eventos.length, 0)
  assert.equal(t2.transporte, undefined)
  b.limpiar()
  assert.equal(b.tomaActual(), null)
})

test('análisis: tempo, micro-timing respecto a la rejilla, flams y acordes', () => {
  const notas: NotaEscuchada[] = []
  // Corcheas a 120 BPM (250 ms) tocadas 6 ms tarde de forma sistemática (salvo la primera).
  for (let i = 0; i < 8; i++) notas.push({ pitch: 60 + i, velocity: 80 + i, inicioMs: i * 250 + (i ? 6 : 0), duracionMs: 200 })
  // Un acorde arpegiado (3 notas en 12 ms) y un flam (dos golpes a 20 ms).
  notas.push({ pitch: 48, velocity: 90, inicioMs: 2000, duracionMs: 400 })
  notas.push({ pitch: 52, velocity: 90, inicioMs: 2006, duracionMs: 400 })
  notas.push({ pitch: 55, velocity: 90, inicioMs: 2012, duracionMs: 400 })
  notas.push({ pitch: 38, velocity: 60, inicioMs: 2500, duracionMs: 50 })
  notas.push({ pitch: 38, velocity: 110, inicioMs: 2520, duracionMs: 50 })
  const a = analizarEjemploMidi(notas, { bpm: 120, rejillaBeats: 0.5 })
  assert.equal(a.notas, 13)
  assert.equal(a.acordes, 1)
  assert.equal(a.dispersionAcordeMs, 12)
  assert.ok(a.flams >= 1)
  assert.equal(a.bpmEstimado, 120)
  assert.ok(a.microtiming && a.microtiming.desvioMedioMs > 0, 'tocado tarde → desvío positivo')
  assert.ok(a.microtiming!.desvioMaxMs <= 20)
})

test('análisis: sin notas devuelve un resultado vacío', () => {
  const a = analizarEjemploMidi([])
  assert.equal(a.notas, 0)
  assert.equal(a.bpmEstimado, null)
})
