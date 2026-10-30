/**
 * npx tsx --test electron/plugins/watchdog.test.ts
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { Watchdog, mensajeWatchdog, type MuestraSlot } from './watchdog'

const m = (path: string, avgLoad: number, exceptions = 0, overruns = 0): MuestraSlot => ({ path, avgLoad, overruns, exceptions })

describe('watchdog de plugins (V5 §2.4)', () => {
  it('la saturación sostenida (10 muestras) solo AVISA: no aparta el plugin y no repite el aviso en un minuto', () => {
    const w = new Watchdog()
    for (let i = 0; i < 9; i++) assert.deepEqual(w.evaluar([m('A', 0.95), m('B', 0.2)], i * 1000), [])
    const d = w.evaluar([m('A', 0.97), m('B', 0.2)], 9000)
    assert.equal(d.length, 1)
    assert.equal(d[0]!.plugin, 'A')
    assert.equal(d[0]!.motivo, 'saturacion')
    assert.equal(d[0]!.accion, 'avisar')
    assert.match(mensajeWatchdog(d[0]!), /mucha CPU/)
    // sigue vigilado (no apartado), pero no vuelve a avisar hasta pasado el minuto
    const enElMinuto = Array.from({ length: 20 }, (_, i) => w.evaluar([m('A', 0.99)], 10_000 + i * 1000)).flat()
    assert.deepEqual(enElMinuto, [])
    const despues = Array.from({ length: 12 }, (_, i) => w.evaluar([m('A', 0.99)], 70_000 + i * 1000)).flat()
    assert.equal(despues.length, 1)
    assert.equal(despues[0]!.accion, 'avisar')
  })

  it('un sampler pesado que se pasa de tiempo al cargar un kit (p. ej. BFD) no se aparta', () => {
    const w = new Watchdog()
    // carga moderada con bloques fuera de tiempo durante 15 s seguidos, como al cargar un kit de varios GB
    const d = Array.from({ length: 15 }, (_, i) => w.evaluar([m('BFDPlayer.vst3', 0.6, 0, 3)], i * 1000)).flat()
    assert.ok(d.every((x) => x.accion === 'avisar'), 'solo avisos, nunca cuarentena por CPU')
  })

  it('un pico aislado no basta: la racha se reinicia', () => {
    const w = new Watchdog()
    const seq = [0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.3, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95, 0.95]
    const d = seq.flatMap((c, i) => w.evaluar([m('A', c)], i * 1000))
    assert.deepEqual(d, [])
  })

  it('tres excepciones en un minuto apartan el plugin; espaciadas no', () => {
    const w = new Watchdog()
    assert.deepEqual(w.evaluar([m('X', 0.1, 0)], 0), [])
    assert.deepEqual(w.evaluar([m('X', 0.1, 1)], 10_000), [])
    assert.deepEqual(w.evaluar([m('X', 0.1, 2)], 20_000), [])
    const d = w.evaluar([m('X', 0.1, 3)], 30_000)
    assert.equal(d[0]?.motivo, 'excepciones')

    const y = new Watchdog()
    y.evaluar([m('Y', 0.1, 0)], 0)
    y.evaluar([m('Y', 0.1, 1)], 0)
    y.evaluar([m('Y', 0.1, 2)], 70_000)
    assert.deepEqual(y.evaluar([m('Y', 0.1, 3)], 140_000), [])
  })

  it('el contador previo al arrancar no cuenta como excepciones nuevas', () => {
    const w = new Watchdog()
    assert.deepEqual(w.evaluar([m('Z', 0.1, 50)], 0), [])
  })

  it('rehabilitar vuelve a vigilar desde cero', () => {
    const w = new Watchdog({ cargaMaxima: 0.9, muestrasSeguidas: 1, excepcionesMax: 1, ventanaExcepcionesMs: 60_000, esperaAvisoMs: 60_000 }, true)
    assert.equal(w.evaluar([m('A', 0.1, 1)], 0)[0]?.accion, 'apartar')
    assert.equal(w.evaluar([m('A', 0.1, 2)], 1).length, 0) // ya apartado
    w.rehabilitar('A')
    assert.equal(w.evaluar([m('A', 0.1, 3)], 2)[0]?.accion, 'apartar')
  })
})
