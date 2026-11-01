import { afterEach, describe, expect, it } from 'vitest'
import { api, definirModulo, instalarRuntime, runtime, VERSION_SDK, type RuntimeJasWave } from '../src/index-contrato'

const g = globalThis as Record<string, unknown>
const host = (version = VERSION_SDK): RuntimeJasWave => ({
  version,
  react: {},
  reactDom: {},
  reactDomClient: {},
  jsxRuntime: {},
  api: { sumar: (a: number, b: number) => a + b },
})

describe('runtime del SDK', () => {
  afterEach(() => {
    delete g.__JASWAVE_SDK__
  })

  it('sin host instalado el módulo falla con un mensaje claro', () => {
    expect(() => runtime()).toThrow(/dentro de JasWave/)
  })

  it('resuelve la API del host y avisa si falta algo', () => {
    instalarRuntime(host())
    expect(api<(a: number, b: number) => number>('sumar')(2, 3)).toBe(5)
    expect(() => api('inexistente')).toThrow(/no ofrece «inexistente»/)
  })

  it('rechaza un host con otra versión del SDK y no permite reinstalar otro runtime', () => {
    instalarRuntime(host(VERSION_SDK + 1))
    expect(() => runtime()).toThrow(/incompatible/)
    expect(() => instalarRuntime(host())).toThrow(/ya estaba instalado/)
  })

  it('definirModulo devuelve la definición tal cual (solo tipado)', () => {
    const d = { id: 'com.x.y', nombre: 'x', version: '1.0.0', sdk: VERSION_SDK, herramientas: [], activar: () => ({ paneles: {} }) }
    expect(definirModulo(d)).toBe(d)
  })
})
