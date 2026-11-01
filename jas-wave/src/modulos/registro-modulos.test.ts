/**
 * npx tsx --test src/modulos/registro-modulos.test.ts
 * M3: módulos instalables (contrato del SDK): carga → activar → herramientas y contribuciones;
 * desactivar las quita; errores de paquete se informan y se pueden reintentar.
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import { definirModulo, type DefinicionModulo } from '@jaswave/host-sdk/contrato'
import { VERSION_SDK } from '@jaswave/host-sdk/runtime'
import {
  cargarModulo,
  contribuciones,
  fijarModuloActivo,
  listarModulos,
  moduloActivo,
  panelDeHerramienta,
  quitarModulo,
  registrarModulo,
  reiniciarModulosParaPruebas,
} from './registro-modulos'
import { herramientasDisponibles } from './herramientas'
import { TOOL_CATALOG } from '../workspace/types'

const memoria = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => memoria.get(k) ?? null,
  setItem: (k: string, v: string) => void memoria.set(k, v),
  removeItem: (k: string) => void memoria.delete(k),
}

const Panel = () => null

function definicion(id: string, herramienta: string, extra: Partial<DefinicionModulo> = {}, alActivar?: () => void): DefinicionModulo {
  return definirModulo({
    id,
    nombre: id,
    version: '1.0.0',
    sdk: VERSION_SDK,
    herramientas: [{ id: herramienta, titulo: herramienta, descripcion: '', zona: 'left' }],
    activar: (ctx) => {
      alActivar?.()
      ctx.almacen.escribir('activado', '1')
      return { paneles: { [herramienta]: Panel }, menus: { clip: [{ id: `${id}.abrir`, etiqueta: 'Abrir', ejecutar: () => {} }] } }
    },
    ...extra,
  })
}

const fuente = (id: string, cargar: () => Promise<DefinicionModulo>, version = '1.0.0') => ({
  id,
  nombre: id,
  descripcion: '',
  version,
  origen: 'pruebas' as const,
  cargar,
})

describe('M3 — registro de módulos instalables', () => {
  beforeEach(() => {
    memoria.clear()
    reiniciarModulosParaPruebas()
  })

  it('al registrarse activo se carga: aporta herramienta, panel y contribuciones; el núcleo no cambia', async () => {
    await registrarModulo(fuente('com.jaswave.modulo.prueba', async () => definicion('com.jaswave.modulo.prueba', 'prueba-panel')))
    assert.equal(TOOL_CATALOG['prueba-panel']?.moduloId, 'com.jaswave.modulo.prueba')
    assert.equal(panelDeHerramienta('prueba-panel'), Panel)
    assert.ok(herramientasDisponibles().includes('prueba-panel'))
    assert.ok(herramientasDisponibles().includes('arrange'))
    assert.equal(contribuciones()[0]?.menus?.clip?.[0]?.etiqueta, 'Abrir')
    assert.equal(memoria.get('jaswave.modulo.com.jaswave.modulo.prueba.activado'), '1', 'almacén con espacio de nombres')
  })

  it('desactivar quita herramientas y contribuciones (se persiste); reactivar vuelve a cargar', async () => {
    let activaciones = 0
    await registrarModulo(fuente('com.jaswave.modulo.prueba', async () => definicion('com.jaswave.modulo.prueba', 'prueba-panel', {}, () => activaciones++)))
    fijarModuloActivo('com.jaswave.modulo.prueba', false)
    assert.equal(TOOL_CATALOG['prueba-panel'], undefined)
    assert.equal(contribuciones().length, 0)
    assert.equal(moduloActivo('com.jaswave.modulo.prueba'), false)
    assert.match(memoria.get('jaswave.modulos.v1') ?? '', /desactivados/)
    fijarModuloActivo('com.jaswave.modulo.prueba', true)
    await cargarModulo('com.jaswave.modulo.prueba')
    assert.ok(TOOL_CATALOG['prueba-panel'])
    assert.equal(activaciones, 2)
  })

  it('un paquete que no corresponde (id o SDK distinto, sin panel) queda en error y no aporta nada', async () => {
    await registrarModulo(fuente('com.jaswave.modulo.a', async () => definicion('com.jaswave.modulo.otro', 'a-panel')))
    await registrarModulo(fuente('com.jaswave.modulo.b', async () => definicion('com.jaswave.modulo.b', 'b-panel', { sdk: VERSION_SDK + 1 })))
    await registrarModulo(
      fuente('com.jaswave.modulo.c', async () => ({ ...definicion('com.jaswave.modulo.c', 'c-panel'), activar: () => ({ paneles: {} }) })),
    )
    const vista = Object.fromEntries(listarModulos().map((m) => [m.fuente.id, m]))
    assert.match(vista['com.jaswave.modulo.a']!.error ?? '', /id/)
    assert.match(vista['com.jaswave.modulo.b']!.error ?? '', /SDK/)
    assert.match(vista['com.jaswave.modulo.c']!.error ?? '', /panel/)
    for (const h of ['a-panel', 'b-panel', 'c-panel']) assert.equal(TOOL_CATALOG[h], undefined)
  })

  it('un fallo de descarga se puede reintentar; una herramienta del núcleo no se puede reemplazar', async () => {
    let fallar = true
    await registrarModulo(
      fuente('com.jaswave.modulo.red', async () => {
        if (fallar) throw new Error('sin red')
        return definicion('com.jaswave.modulo.red', 'red-panel')
      }),
    )
    assert.equal(listarModulos()[0]?.estado, 'error')
    fallar = false
    await cargarModulo('com.jaswave.modulo.red')
    assert.equal(listarModulos()[0]?.estado, 'listo')
    await registrarModulo(fuente('com.jaswave.modulo.malo', async () => definicion('com.jaswave.modulo.malo', 'mixer')))
    assert.equal(TOOL_CATALOG.mixer?.moduloId, undefined, 'mixer sigue siendo del núcleo')
  })

  it('actualizar la versión descarga la anterior; quitar el módulo (desinstalado) limpia todo', async () => {
    let desactivado = 0
    const v1 = definicion('com.jaswave.modulo.prueba', 'prueba-panel')
    const conDesactivar: DefinicionModulo = { ...v1, activar: async (c) => ({ ...(await v1.activar(c)), desactivar: () => desactivado++ }) }
    await registrarModulo(fuente('com.jaswave.modulo.prueba', async () => conDesactivar))
    await registrarModulo(fuente('com.jaswave.modulo.prueba', async () => conDesactivar, '1.1.0'))
    assert.equal(desactivado, 1)
    assert.equal(listarModulos()[0]?.fuente.version, '1.1.0')
    quitarModulo('com.jaswave.modulo.prueba')
    assert.equal(desactivado, 2)
    assert.equal(listarModulos().length, 0)
    assert.equal(TOOL_CATALOG['prueba-panel'], undefined)
  })
})
