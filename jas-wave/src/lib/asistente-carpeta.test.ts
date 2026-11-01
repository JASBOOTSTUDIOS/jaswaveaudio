/**
 * npx tsx --test src/lib/asistente-carpeta.test.ts
 */
import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  carpetaAsistente,
  escribirDocumentoAsistente,
  leerDocumentoAsistente,
  rutaAsistente,
  type PuenteCarpetaAsistente,
} from './asistente-carpeta'

const g = globalThis as unknown as { window?: unknown; localStorage?: Storage }

function memoria(): Storage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size
    },
  }
}

describe('documentos del asistente', () => {
  it('lee y escribe el formato común (título, descripción, desactivada, cuerpo)', () => {
    const texto = escribirDocumentoAsistente({ titulo: 'Batería lenta', descripcion: 'temas de adoración', activo: false, cuerpo: 'Bombo en 1 y 3.\n\nCross-stick.' })
    assert.equal(texto, '# Batería lenta\n> temas de adoración\n<!-- desactivada -->\n\nBombo en 1 y 3.\n\nCross-stick.\n')
    assert.deepEqual(leerDocumentoAsistente(texto), { titulo: 'Batería lenta', descripcion: 'temas de adoración', activo: false, cuerpo: 'Bombo en 1 y 3.\n\nCross-stick.' })
    assert.deepEqual(leerDocumentoAsistente('Solo texto', 'mi-prompt'), { titulo: 'mi prompt', descripcion: '', activo: true, cuerpo: 'Solo texto' })
    assert.equal(rutaAsistente('prompts', 'Intro épica'), 'prompts/intro-epica.md')
  })
})

describe('carpetaAsistente', () => {
  beforeEach(() => {
    carpetaAsistente.reiniciar()
    g.localStorage = memoria()
    g.window = { dispatchEvent: () => true }
  })

  it('sin escritorio guarda en el navegador: crear, editar, eliminar y recuperar', async () => {
    await carpetaAsistente.escribir('planes/mezcla.md', '# Mezcla\nPaso 1')
    await carpetaAsistente.escribir('reglas.md', 'Responde breve.')
    carpetaAsistente.reiniciar()
    await carpetaAsistente.cargar()
    assert.deepEqual(carpetaAsistente.archivos().map((a) => a.ruta), ['reglas.md', 'planes/mezcla.md'])
    assert.equal(carpetaAsistente.archivo('planes/mezcla.md')?.carpeta, 'planes')

    assert.equal(await carpetaAsistente.eliminar('planes/mezcla.md'), true)
    assert.equal(carpetaAsistente.archivo('planes/mezcla.md'), undefined)
    assert.equal(await carpetaAsistente.restaurar('planes/mezcla.md'), true)
    assert.equal(carpetaAsistente.archivo('planes/mezcla.md')?.contenido, '# Mezcla\nPaso 1')
    await assert.rejects(() => carpetaAsistente.escribir('../x.md', 'x'), /no válido/)
  })

  it('en el escritorio usa el puente de main', async () => {
    const llamadas: string[] = []
    const puente: PuenteCarpetaAsistente = {
      listar: async () => ({ ok: true, carpeta: 'C:/u/asistente', archivos: [{ ruta: 'prompts/intro.md', carpeta: 'prompts', nombre: 'intro', contenido: '# Intro', modificado: 1 }] }),
      escribir: async (r) => (llamadas.push(`w:${r}`), { ok: true }),
      eliminar: async (r) => (llamadas.push(`d:${r}`), { ok: true, existia: true }),
      restaurar: async () => ({ ok: true, restaurado: false }),
      abrir: async () => ({ ok: true }),
    }
    g.window = { dispatchEvent: () => true, electron: { asistenteCarpeta: puente } }
    await carpetaAsistente.cargar()
    assert.equal(carpetaAsistente.ubicacion, 'C:/u/asistente')
    assert.equal(carpetaAsistente.archivos()[0]?.ruta, 'prompts/intro.md')
    await carpetaAsistente.escribir('habilidades/coro.md', '# Coro')
    await carpetaAsistente.eliminar('prompts/intro.md')
    assert.deepEqual(llamadas, ['w:habilidades/coro.md', 'd:prompts/intro.md'])
    assert.deepEqual(carpetaAsistente.archivos().map((a) => a.ruta), ['habilidades/coro.md'])
  })
})
