import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ColaPipeMezcla } from './mix-pipe-queue'

const paquete = (n: number) => Buffer.from([n])

describe('ColaPipeMezcla', () => {
  it('retiene varios paquetes durante un atasco breve sin descartar', () => {
    const cola = new ColaPipeMezcla(1024)
    for (let i = 0; i < 4; i++) cola.encolar(paquete(i), 256)
    assert.equal(cola.length, 4)
    assert.equal(cola.descartados, 0)
    assert.equal(cola.primero()?.[0], 0)
  })

  it('con un atasco largo descarta los más antiguos y conserva el más reciente', () => {
    const cola = new ColaPipeMezcla(512)
    for (let i = 0; i < 5; i++) cola.encolar(paquete(i), 256)
    assert.equal(cola.frames, 512)
    assert.equal(cola.descartados, 3)
    assert.equal(cola.primero()?.[0], 3)
    cola.quitarPrimero()
    assert.equal(cola.primero()?.[0], 4)
    assert.equal(cola.frames, 256)
  })

  it('un paquete mayor que el tope no se pierde', () => {
    const cola = new ColaPipeMezcla(100)
    cola.encolar(paquete(9), 400)
    assert.equal(cola.length, 1)
    cola.vaciar()
    assert.equal(cola.length, 0)
    assert.equal(cola.frames, 0)
  })
})
