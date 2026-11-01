import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { hostsHuerfanos, parsearProcesosHost } from './host-huerfanos'

describe('hosts huérfanos', () => {
  it('parsea la salida pid/ppid ignorando ruido', () => {
    assert.deepEqual(parsearProcesosHost('120 44\r\n\r\nbasura\n 300  7 \n'), [
      { pid: 120, ppid: 44 },
      { pid: 300, ppid: 7 },
    ])
  })

  it('no toca el motor de otra instancia viva: solo el host cuyo padre murió', () => {
    const vivos = new Set([44])
    const procesos = [
      { pid: 120, ppid: 44 }, // de otra JasWave abierta
      { pid: 300, ppid: 7 }, // su app ya no existe
    ]
    assert.deepEqual(hostsHuerfanos(procesos, (p) => vivos.has(p)), [300])
  })

  it('excluye los propios y trata padre 0 como huérfano', () => {
    const procesos = [
      { pid: 5, ppid: 0 },
      { pid: 6, ppid: 0 },
    ]
    assert.deepEqual(hostsHuerfanos(procesos, () => false, [6]), [5])
  })
})
