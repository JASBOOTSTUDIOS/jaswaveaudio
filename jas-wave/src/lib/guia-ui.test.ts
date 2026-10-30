import { afterEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  configurarGuia, evaluarEstadoPaso, expirarResaltado, iniciarGuia, listarIdsAyuda, localizarElemento, notificarSenal,
  obtenerEstadoGuia, recortarTexto, registrarIdsAyuda, registrarPredicadoEstado, reiniciarGuia, reiniciarRegistroAyuda,
  resaltarElemento, resolverIdAyuda, siguientePaso, descartarGuia, MAX_TEXTO_GUIA,
} from './guia-ui'
import { abrirPantalla, resolverPantalla, type EfectosApertura } from './abrir-pantalla'

afterEach(() => {
  reiniciarGuia()
  reiniciarRegistroAyuda()
})

describe('resolución de ids de ayuda', () => {
  it('un panel resuelve a data-ayuda, data-testid y fallback data-tool-viewport', () => {
    const d = resolverIdAyuda('mixer')
    assert.ok(d)
    assert.deepEqual(d.selectores, ['[data-ayuda="mixer"]', '[data-testid="mixer"]', '[data-tool-viewport="mixer"]'])
  })
  it('localizarElemento usa el primer selector que exista (fallback)', () => {
    const d = resolverIdAyuda('mixer')!
    const el = localizarElemento(d, (s) => (s.includes('data-tool-viewport') ? 'panel' : null))
    assert.equal(el, 'panel')
  })
  it('rechaza selectores libres y entradas raras', () => {
    for (const malo of ['body > div', '[data-x]', 'a"]; x', '.clase', '#id', '', 'MIXER', 'x'.repeat(100), 42, null, { a: 1 }]) {
      assert.equal(resolverIdAyuda(malo), null, String(malo))
      assert.deepEqual(resaltarElemento({ id: malo as string, texto: 'hola' }).ok, false)
    }
    assert.equal(obtenerEstadoGuia().resaltado, null)
  })
  it('un id válido pero no registrado se rechaza hasta registrarlo', () => {
    assert.equal(resolverIdAyuda('control-nuevo'), null)
    const r = registrarIdsAyuda(['control-nuevo', 'mal id', { id: 'otro', toolViewport: 'mixer' }, { id: 'x', toolViewport: 'a b' }])
    assert.deepEqual(r.registrados, ['control-nuevo', 'otro'])
    assert.deepEqual(r.rechazados, ['mal id', 'x'])
    assert.ok(resolverIdAyuda('control-nuevo'))
    assert.ok(resolverIdAyuda('otro')!.selectores.includes('[data-tool-viewport="mixer"]'))
    assert.ok(listarIdsAyuda().includes('mi-estilo-analizar'))
  })
})

describe('resaltado', () => {
  it('fija un resaltado, recorta el texto y expira', () => {
    let t = 1000
    configurarGuia({ ahora: () => t })
    assert.deepEqual(resaltarElemento({ id: 'mixer', texto: 'a'.repeat(300), duracionMs: 5000 }), { ok: true })
    const r = obtenerEstadoGuia().resaltado!
    assert.equal(r.texto.length, MAX_TEXTO_GUIA)
    t += 4999
    expirarResaltado()
    assert.ok(obtenerEstadoGuia().resaltado)
    t += 2
    expirarResaltado()
    assert.equal(obtenerEstadoGuia().resaltado, null)
  })
  it('solo hay uno activo: el nuevo reemplaza al anterior; el texto vacío se rechaza', () => {
    resaltarElemento({ id: 'mixer', texto: 'uno' })
    resaltarElemento({ id: 'arrange', texto: 'dos' })
    assert.equal(obtenerEstadoGuia().resaltado!.id, 'arrange')
    assert.equal(resaltarElemento({ id: 'arrange', texto: '   ' }).ok, false)
    assert.equal(recortarTexto('  a   b '), 'a b')
  })
})

describe('pasos con hastaQue', () => {
  it('avanza al cumplirse, abre pantallas y termina', () => {
    const abiertas: string[] = []
    configurarGuia({ abrir: (id) => abiertas.push(id) })
    const ok = iniciarGuia([
      { texto: 'Abre el mezclador', abrir: 'mixer', resaltar: 'mixer', hastaQue: { evento: 'tool-abierta', id: 'mixer' } },
      { texto: 'Pulsa analizar', resaltar: 'mi-estilo-analizar', hastaQue: { clic: 'mi-estilo-analizar' } },
      { texto: 'Listo', hastaQue: { manual: true } },
    ])
    assert.deepEqual(ok, { ok: true })
    assert.deepEqual(abiertas, ['mixer'])
    assert.equal(obtenerEstadoGuia().paso, 0)
    assert.equal(notificarSenal({ tipo: 'tool-abierta', id: 'arrange' }), false, 'otra herramienta no avanza')
    assert.equal(notificarSenal({ tipo: 'clic', id: 'mi-estilo-analizar' }), false, 'señal de otro paso')
    assert.equal(notificarSenal({ tipo: 'tool-abierta', id: 'mixer' }), true)
    assert.equal(obtenerEstadoGuia().paso, 1)
    assert.equal(obtenerEstadoGuia().resaltado!.id, 'mi-estilo-analizar')
    assert.equal(notificarSenal({ tipo: 'clic', id: 'mi-estilo-analizar' }), true)
    assert.equal(obtenerEstadoGuia().paso, 2)
    assert.equal(obtenerEstadoGuia().resaltado, null, 'paso sin resaltar')
    notificarSenal({ tipo: 'manual' })
    assert.equal(obtenerEstadoGuia().terminada, true)
  })
  it('predicados de estado nombrados avanzan al evaluar; los desconocidos se rechazan', () => {
    assert.equal(iniciarGuia([{ texto: 'x', hastaQue: { estado: 'no-existe' } }]).ok, false)
    let armada = false
    registrarPredicadoEstado('hay-pista-midi-armada', () => armada)
    assert.equal(iniciarGuia([{ texto: 'Arma una pista', hastaQue: { estado: 'hay-pista-midi-armada' } }, { texto: 'fin' }]).ok, true)
    assert.equal(evaluarEstadoPaso(), false)
    armada = true
    assert.equal(evaluarEstadoPaso(), true)
    assert.equal(obtenerEstadoGuia().paso, 1)
  })
  it('un predicado que lanza no avanza ni rompe', () => {
    registrarPredicadoEstado('roto', () => { throw new Error('x') })
    iniciarGuia([{ texto: 'a', hastaQue: { estado: 'roto' } }, { texto: 'b' }])
    assert.equal(evaluarEstadoPaso(), false)
  })
  it('rechaza ids no registrados, hastaQue libres y demasiados pasos', () => {
    assert.match((iniciarGuia([{ texto: 'a', resaltar: 'div > span' }]) as { motivo: string }).motivo, /paso 1/)
    assert.equal(iniciarGuia([{ texto: 'a', hastaQue: { clic: 'body' } }]).ok, false)
    assert.equal(iniciarGuia([{ texto: 'a', hastaQue: { js: 'alert(1)' } as never }]).ok, false)
    assert.equal(iniciarGuia([{ texto: 'a', hastaQue: { manual: false } as never }]).ok, false)
    assert.equal(iniciarGuia([{ texto: '' }]).ok, false)
    assert.equal(iniciarGuia([]).ok, false)
    assert.equal(iniciarGuia(Array.from({ length: 21 }, () => ({ texto: 'a' }))).ok, false)
    assert.equal(obtenerEstadoGuia().paso, -1)
  })
  it('siguiente, pausa y descartar', () => {
    iniciarGuia([{ texto: 'a', hastaQue: { manual: true } }, { texto: 'b' }])
    siguientePaso()
    assert.equal(obtenerEstadoGuia().paso, 1)
    descartarGuia()
    assert.equal(obtenerEstadoGuia().paso, -1)
    assert.equal(notificarSenal({ tipo: 'manual' }), false)
  })
})

describe('abrir pantallas', () => {
  const efectos = () => {
    const llamadas: unknown[][] = []
    const e: EfectosApertura = {
      abrirHerramienta: (t) => llamadas.push(['T', t]),
      despachar: (n, d) => llamadas.push(['ev', n, d]),
    }
    return { e, llamadas }
  }
  it('herramientas por T, diálogos por M/E, con o sin prefijo panel:', () => {
    const { e, llamadas } = efectos()
    assert.equal(abrirPantalla('mixer', e).abierto, true)
    assert.equal(abrirPantalla('panel:grooves', e).abierto, true)
    assert.equal(abrirPantalla('dlg.exportar-bounce', e).abierto, true)
    assert.equal(abrirPantalla('dlg.atajos', e).abierto, true)
    assert.deepEqual(llamadas, [
      ['T', 'mixer'],
      ['T', 'grooves'],
      ['ev', 'jaswave-menu-action', { id: 'archivo.exportarBounce' }],
      ['ev', 'open-shortcuts-dialog', undefined],
    ])
  })
  it('ids desconocidos o peligrosos no hacen nada', () => {
    const { e, llamadas } = efectos()
    for (const id of ['proyecto.cerrar', 'proyecto.guardar', 'toString', '__proto__', 'x', '', 5, null]) {
      assert.equal(abrirPantalla(id, e).abierto, false, String(id))
    }
    assert.equal(llamadas.length, 0)
    assert.equal(resolverPantalla('dlg.abrir-proyecto')?.via, 'M')
  })
})
