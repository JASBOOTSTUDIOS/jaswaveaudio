import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_INTENTOS_RESTAURACION,
  crearAutoguardadoEstadoVst,
  descartarEstadoParaMover,
  guardarEstadoParaMover,
  limpiarEstadoParaMover,
  listarRestauracionesPendientes,
  marcarRestauracionPendiente,
  olvidarRestauraciones,
  restauracionPendiente,
  restaurarEstadoSlot,
  verEstadoParaMover,
} from './vst-estado'

const sinEspera = async () => undefined

beforeEach(() => {
  olvidarRestauraciones()
  limpiarEstadoParaMover()
})

test('restaurar: chunk aceptado al primer intento libera el slot', async () => {
  marcarRestauracionPendiente('t1:p1')
  const aplicados: string[] = []
  const ok = await restaurarEstadoSlot({
    slotId: 't1:p1',
    chunk: 'AAAA',
    aplicar: async (_s, c) => (aplicados.push(c), true),
    esperar: sinEspera,
  })
  assert.equal(ok, true)
  assert.deepEqual(aplicados, ['AAAA'])
  assert.equal(restauracionPendiente('t1:p1'), false)
})

test('restaurar: plugin que llega tarde (falla 2 veces y luego acepta) se restaura sin fallback', async () => {
  marcarRestauracionPendiente('t1:p1')
  let n = 0
  let params = 0
  const ok = await restaurarEstadoSlot({
    slotId: 't1:p1',
    chunk: 'BBBB',
    aplicar: async () => ++n >= 3,
    aplicarParametros: async () => {
      params += 1
    },
    esperar: sinEspera,
  })
  assert.equal(ok, true)
  assert.equal(n, 3)
  assert.equal(params, 0, 'con chunk aceptado no se superponen parámetros')
  assert.equal(restauracionPendiente('t1:p1'), false)
})

test('restaurar: si el chunk nunca entra el slot SIGUE pendiente (no se captura el estado de fábrica)', async () => {
  marcarRestauracionPendiente('t1:p1')
  let params = 0
  const ok = await restaurarEstadoSlot({
    slotId: 't1:p1',
    chunk: 'CCCC',
    aplicar: async () => false,
    aplicarParametros: async () => {
      params += 1
    },
    esperar: sinEspera,
  })
  assert.equal(ok, false)
  assert.equal(params, 1)
  assert.equal(restauracionPendiente('t1:p1'), true)
})

test('restaurar: tras MAX_INTENTOS_RESTAURACION llamadas fallidas se desbloquea (plugin incompatible)', async () => {
  marcarRestauracionPendiente('t1:p1')
  for (let i = 0; i < MAX_INTENTOS_RESTAURACION; i++) {
    assert.equal(restauracionPendiente('t1:p1'), true, `pendiente antes del intento ${i + 1}`)
    await restaurarEstadoSlot({ slotId: 't1:p1', chunk: 'X', aplicar: async () => false, esperar: sinEspera })
  }
  assert.equal(restauracionPendiente('t1:p1'), false)
})

test('restaurar: una excepción del host cuenta como fallo, no rompe', async () => {
  marcarRestauracionPendiente('t1:p1')
  const ok = await restaurarEstadoSlot({
    slotId: 't1:p1',
    chunk: 'X',
    aplicar: async () => {
      throw new Error('host caído')
    },
    esperar: sinEspera,
  })
  assert.equal(ok, false)
  assert.equal(restauracionPendiente('t1:p1'), true)
})

test('restaurar: sin chunk usa parámetros y libera el slot', async () => {
  marcarRestauracionPendiente('t1:p1')
  let params = 0
  const ok = await restaurarEstadoSlot({
    slotId: 't1:p1',
    chunk: undefined,
    aplicar: async () => {
      throw new Error('no debe llamarse')
    },
    aplicarParametros: async () => {
      params += 1
    },
  })
  assert.equal(ok, true)
  assert.equal(params, 1)
  assert.equal(restauracionPendiente('t1:p1'), false)
})

test('mover entre pistas: el estado vivo guardado gana al del proyecto y caduca', () => {
  guardarEstadoParaMover('p1', 'VIVO', 1000)
  assert.equal(verEstadoParaMover('p1', 1500), 'VIVO')
  assert.equal(verEstadoParaMover('p1', 1500), 'VIVO', 'ver no consume: un reintento lo necesita')
  descartarEstadoParaMover('p1')
  assert.equal(verEstadoParaMover('p1', 1500), undefined)
  guardarEstadoParaMover('p2', 'X', 1000)
  assert.equal(verEstadoParaMover('p2', 1000 + 121_000), undefined, 'caduca')
})

test('dos instancias del mismo plugin no comparten estado pendiente', () => {
  marcarRestauracionPendiente('t1:p1')
  assert.equal(restauracionPendiente('t1:p1'), true)
  assert.equal(restauracionPendiente('t2:p9'), false)
  olvidarRestauraciones('t1:p1')
  assert.deepEqual(listarRestauracionesPendientes(), [])
})

test('autoguardado: captura periódica, omite si está ocupado y no se solapa', async () => {
  let ocupado = false
  let capturas = 0
  let reintentos = 0
  const puerta: { liberar: () => void } = { liberar: () => undefined }
  const auto = crearAutoguardadoEstadoVst({
    ocupado: () => ocupado,
    reintentarPendientes: async () => {
      reintentos += 1
    },
    capturar: () =>
      new Promise<void>((resolve) => {
        capturas += 1
        puerta.liberar = resolve
      }),
  })
  const t1 = auto.tick()
  await Promise.resolve()
  assert.equal(await auto.tick(), false, 'segundo ciclo mientras el primero sigue: se omite')
  assert.equal(capturas, 1)
  await new Promise((r) => setTimeout(r, 0))
  puerta.liberar()
  assert.equal(await t1, true)
  ocupado = true // play en curso
  assert.equal(await auto.tick(), false)
  assert.equal(capturas, 1)
  assert.equal(reintentos, 1)
})

test('autoguardado: un fallo de captura no detiene los ciclos siguientes', async () => {
  let capturas = 0
  const auto = crearAutoguardadoEstadoVst({
    ocupado: () => false,
    reintentarPendientes: async () => {
      throw new Error('x')
    },
    capturar: async () => {
      capturas += 1
      throw new Error('host muerto')
    },
  })
  assert.equal(await auto.tick(), true)
  assert.equal(await auto.tick(), true)
  assert.equal(capturas, 2)
})

test('autoguardado: start/stop usan el intervalo inyectado una sola vez', () => {
  let fn: (() => void) | null = null
  let creados = 0
  let borrados = 0
  const auto = crearAutoguardadoEstadoVst({
    intervaloMs: 1234,
    ocupado: () => false,
    reintentarPendientes: async () => undefined,
    capturar: async () => undefined,
    setIntervalFn: (f, ms) => {
      assert.equal(ms, 1234)
      creados += 1
      fn = f
      return 7
    },
    clearIntervalFn: (h) => {
      assert.equal(h, 7)
      borrados += 1
    },
  })
  auto.start()
  auto.start()
  assert.equal(creados, 1)
  assert.ok(fn)
  auto.stop()
  auto.stop()
  assert.equal(borrados, 1)
})
