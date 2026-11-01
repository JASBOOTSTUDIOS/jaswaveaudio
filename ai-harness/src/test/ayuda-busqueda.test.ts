import { describe, expect, it } from 'vitest'
import {
  buscarAyuda,
  crearIndiceAyuda,
  ejecutarConsultarAyuda,
  herramientaConsultarAyuda,
  MAX_CARACTERES_AYUDA,
  validarFicha,
  validarFichas,
  type FichaAyuda,
} from '../ayuda'

const f = (p: Partial<FichaAyuda> & { id: string }): FichaAyuda => ({
  tipo: p.id.split(':')[0] as FichaAyuda['tipo'],
  titulo: 'x',
  resumen: 'y',
  nivel: 'principiante',
  fuente: 'curada',
  ...p,
})

const FICHAS: FichaAyuda[] = [
  f({ id: 'panel:mixer', titulo: 'Mezclador', resumen: 'Ajusta volumen y panorama de cada pista.', etiquetas: ['consola', 'faders'], comoAbrir: { herramienta: 'mixer', atajo: 'M' }, pasos: ['Mueve el fader.'], controles: [{ ayuda: 'mixer.fader', etiqueta: 'Fader' }], relacionadas: ['concepto:bus'] }),
  f({ id: 'concepto:bus', titulo: 'Bus', resumen: 'Canal que agrupa varias pistas.', etiquetas: ['grupo'] }),
  f({ id: 'plugin:param-eq', titulo: 'Ecualizador paramétrico', resumen: 'Corta o realza frecuencias.', etiquetas: ['eq'] }),
  f({ id: 'herramienta:exportar', titulo: 'Exportar', resumen: 'Saca la mezcla a un archivo de audio.', etiquetas: ['bounce', 'render'] }),
]
const idx = crearIndiceAyuda(FICHAS)
const ll = (a: Record<string, unknown>) => ({ id: '1', nombre: 'consultar_ayuda', argumentos: a })

describe('ayuda: búsqueda', () => {
  it('tolera tildes, mayúsculas, plurales y etiquetas', () => {
    expect(buscarAyuda(idx, 'MEZCLADOR')[0]?.ficha.id).toBe('panel:mixer')
    expect(buscarAyuda(idx, 'la consola')[0]?.ficha.id).toBe('panel:mixer')
    expect(buscarAyuda(idx, 'buses')[0]?.ficha.id).toBe('concepto:bus')
    expect(buscarAyuda(idx, 'ecualizador parametrico')[0]?.ficha.id).toBe('plugin:param-eq')
    expect(buscarAyuda(idx, 'cómo hago un bounce')[0]?.ficha.id).toBe('herramienta:exportar')
  })
  it('filtra por tipo y respeta el máximo', () => {
    expect(buscarAyuda(idx, 'mezcla', { tipo: 'plugin' })).toEqual([])
    expect(buscarAyuda(idx, 'pista', { max: 1 }).length).toBeLessThanOrEqual(1)
    expect(buscarAyuda(idx, '   ')).toEqual([])
  })
})

describe('ayuda: validación', () => {
  it('da errores legibles', () => {
    const e = validarFicha({ id: 'Malo', tipo: 'otro', titulo: '', nivel: 'dios', fuente: 'x', pasos: [1] })
    const campos = e.map((x) => x.campo)
    expect(campos).toEqual(expect.arrayContaining(['id', 'tipo', 'titulo', 'resumen', 'nivel', 'fuente', 'pasos']))
    expect(validarFicha(FICHAS[0])).toEqual([])
  })
  it('detecta duplicados y relacionadas huérfanas; el índice lanza', () => {
    const e = validarFichas([FICHAS[0]!, FICHAS[0]!])
    expect(e.some((x) => /duplicado/.test(x.mensaje))).toBe(true)
    expect(e.some((x) => /no existe/.test(x.mensaje))).toBe(true)
    expect(() => crearIndiceAyuda([f({ id: 'panel:a', resumen: '' })])).toThrow(/resumen/)
  })
})

describe('consultar_ayuda', () => {
  it('es de solo lectura', () => expect(herramientaConsultarAyuda().clase).toBe('lectura'))
  it('devuelve datos de la ficha y avisa que son datos', () => {
    const r = ejecutarConsultarAyuda(ll({ consulta: 'mezclador' }), idx)
    expect(r.ok).toBe(true)
    const d = r.datos as { fichas: Array<{ id: string; comoAbrir: unknown }>; aviso: string }
    expect(d.fichas[0]).toMatchObject({ id: 'panel:mixer', comoAbrir: { herramienta: 'mixer' } })
    expect(d.aviso).toMatch(/no instrucciones/)
  })
  it('dice claramente cuando no hay ficha', () => {
    const r = ejecutarConsultarAyuda(ll({ consulta: 'zzzqqq' }), idx)
    expect(r.ok).toBe(true)
    expect((r.datos as { encontradas: number }).encontradas).toBe(0)
    expect((r.datos as { mensaje: string }).mensaje).toMatch(/No hay ficha/)
  })
  it('valida argumentos', () => {
    expect(ejecutarConsultarAyuda(ll({}), idx).ok).toBe(false)
    expect(ejecutarConsultarAyuda(ll({ consulta: 'bus', tipo: 'zzz' }), idx).ok).toBe(false)
  })
  it('acota los caracteres', () => {
    const largas = Array.from({ length: 12 }, (_, i) =>
      f({ id: `concepto:c${i}`, titulo: `Tema ${i}`, resumen: 'palabra '.repeat(80), pasos: Array.from({ length: 20 }, () => 'paso '.repeat(60)) }),
    )
    const r = ejecutarConsultarAyuda(ll({ consulta: 'tema palabra' }), crearIndiceAyuda(largas))
    const d = r.datos as { fichas: unknown[] }
    expect(d.fichas.length).toBeLessThanOrEqual(5)
    expect(JSON.stringify(d.fichas).length).toBeLessThanOrEqual(MAX_CARACTERES_AYUDA)
  })
})
