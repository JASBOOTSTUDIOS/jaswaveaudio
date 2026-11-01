import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'node:test'
import {
  anexarFuentesAlTexto,
  extraerUrls,
  formatearFuentes,
  fuentesDelTurno,
  limpiarFuentesDelTurno,
  registrarFuenteDelTurno,
  tomarFuentesDelTurno,
} from './fuentes-del-turno'

describe('fuentes-del-turno', () => {
  beforeEach(() => limpiarFuentesDelTurno())

  it('registra sin duplicados, normaliza (sin #fragmento) e ignora lo que no es http(s)', () => {
    registrarFuenteDelTurno({ url: 'https://es.wikipedia.org/wiki/Bachata#Historia', herramienta: 'web.leer' })
    registrarFuenteDelTurno({ url: 'https://es.wikipedia.org/wiki/Bachata', titulo: 'Bachata', herramienta: 'web.buscar' })
    registrarFuenteDelTurno({ url: 'javascript:alert(1)', herramienta: 'web.leer' })
    registrarFuenteDelTurno({ url: 'file:///C:/x', herramienta: 'web.leer' })
    const f = fuentesDelTurno()
    assert.equal(f.length, 1)
    assert.equal(f[0]!.url, 'https://es.wikipedia.org/wiki/Bachata')
    assert.equal(f[0]!.titulo, 'Bachata', 'conserva el primer título no vacío')
  })

  it('extrae URLs de un texto sin la puntuación final', () => {
    assert.deepEqual(extraerUrls('Mira https://a.example/x, y (https://b.example/y). Repetida: https://a.example/x'), ['https://a.example/x', 'https://b.example/y'])
    assert.deepEqual(extraerUrls('sin enlaces'), [])
  })

  it('anexa «Fuentes:» solo con los enlaces que la respuesta no cita ya', () => {
    registrarFuenteDelTurno({ url: 'https://a.example/x', titulo: 'Artículo A', herramienta: 'web.leer' })
    registrarFuenteDelTurno({ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', titulo: 'Vídeo', herramienta: 'youtube.ficha' })
    const texto = 'La bachata va a 125 BPM según https://a.example/x.'
    const out = anexarFuentesAlTexto(texto)
    assert.equal(out, `${texto}\n\nFuentes:\n- [Vídeo](https://www.youtube.com/watch?v=dQw4w9WgXcQ)`)
    assert.equal(anexarFuentesAlTexto(out), out, 'idempotente')
    assert.equal(anexarFuentesAlTexto('sin internet', []), 'sin internet')
    assert.equal(formatearFuentes([{ url: 'https://www.ejemplo.com/p', herramienta: 'web.leer' }]), 'Fuentes:\n- [ejemplo.com](https://www.ejemplo.com/p)')
  })

  it('tomarFuentesDelTurno devuelve y vacía', () => {
    registrarFuenteDelTurno({ url: 'https://a.example/', herramienta: 'web.buscar' })
    assert.equal(tomarFuentesDelTurno().length, 1)
    assert.equal(fuentesDelTurno().length, 0)
  })
})
