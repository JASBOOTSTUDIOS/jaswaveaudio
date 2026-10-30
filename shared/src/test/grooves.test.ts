import { describe, expect, it } from 'vitest'
import {
  aplicarDiferencias,
  arbolDeEstilos,
  construirNotasDeGroove,
  datosDeCancion,
  filtrarGrooves,
  fusionarMetadatos,
  inferirMetadatos,
  parsearCompas,
  type EntradaGroove,
} from '../grooves'
import { escribirSmf, leerSmf } from '../midi/smf'

const meta = (ruta: string, extra: Partial<EntradaGroove> = {}): EntradaGroove => ({
  ...fusionarMetadatos({
    ruta,
    inferidos: inferirMetadatos(ruta, { bpm: 90, compas: { numerador: 4, denominador: 4 }, duracionBeats: 8, notas: 4 }),
    sha256: 'abcdef0123456789abcdef',
  }),
  ruta,
  notas: 4,
  ...extra,
})

describe('grooves · metadatos', () => {
  it('infiere estilo, subestilo, compases y tipo desde la ruta y el midi', () => {
    const g = meta('Worship/6-8/02_fill-final.mid')
    expect(g.estilo).toBe('Worship')
    expect(g.subestilo).toBe('6-8')
    expect(g.compases).toBe(2)
    expect(g.tipo).toBe('fill')
    expect(g.nombre).toBe('fill final')
    expect(g.id).toBe('usr-abcdef012345')
    expect(g.origen).toBe('usuario')
  })

  it('el sidecar manda sobre groove.json y este sobre lo inferido; se valida todo', () => {
    const ruta = 'Rock/a.mid'
    const g = fusionarMetadatos({
      ruta,
      inferidos: inferirMetadatos(ruta, { bpm: 90, duracionBeats: 4, notas: 1 }),
      carpeta: { licencia: 'CC0', intensidad: 9, archivos: { 'a.mid': { nombre: 'Rock A', etiquetas: ['Duro', 'duro', 'Ñandú'], compas: '12/8' } } },
      sidecar: { tempo: 130, id: 'Mi Id', tipo: 'Relleno', origen: 'catalogo', revision: 3 },
      sha256: 'f'.repeat(64),
    })
    expect(g).toMatchObject({ id: 'mi-id', nombre: 'Rock A', tempo: 130, tipo: 'fill', intensidad: 5, licencia: 'CC0', origen: 'catalogo', revision: 3 })
    expect(g.compas).toEqual({ numerador: 12, denominador: 8 })
    expect(g.etiquetas).toEqual(['duro', 'nandu'])
  })

  it('parsea compases y rechaza los inválidos', () => {
    expect(parsearCompas('6/8')).toEqual({ numerador: 6, denominador: 8 })
    expect(parsearCompas('4/3')).toBeNull()
    expect(parsearCompas('x')).toBeNull()
  })
})

describe('grooves · consulta', () => {
  const lista = [
    meta('Pop/a.mid', { tipo: 'groove', intensidad: 2, etiquetas: ['suave'] }),
    meta('Pop/Balada/b.mid', { tipo: 'fill', intensidad: 4, favorito: true, id: 'b' }),
    meta('Rock/c.mid', { compas: { numerador: 6, denominador: 8 }, id: 'c', etiquetas: ['suave', 'ride'] }),
  ]
  it('filtra por estilo, tipo, compás, etiquetas, intensidad, favoritos y texto', () => {
    expect(filtrarGrooves(lista, { estilo: 'pop' })).toHaveLength(2)
    expect(filtrarGrooves(lista, { tipo: 'relleno' })).toHaveLength(1)
    expect(filtrarGrooves(lista, { compas: '6/8' })).toHaveLength(1)
    expect(filtrarGrooves(lista, { etiquetas: ['suave', 'ride'] })).toHaveLength(1)
    expect(filtrarGrooves(lista, { intensidadMin: 4 })).toHaveLength(1)
    expect(filtrarGrooves(lista, { soloFavoritos: true })[0]!.id).toBe('b')
    expect(filtrarGrooves(lista, { texto: 'balada fill' })).toHaveLength(1)
  })
  it('arma el árbol de estilos', () => {
    const t = arbolDeEstilos(lista)
    expect(t.map((n) => n.estilo)).toEqual(['Pop', 'Rock'])
    expect(t[0]!.subestilos).toEqual([{ subestilo: 'Balada', total: 1 }])
  })
})

describe('grooves · notas de clip', () => {
  const m = { compas: { numerador: 4, denominador: 4 }, compases: 1, tempo: 100 }
  const notas = [
    { pitch: 36, velocidad: 100, inicio: 0, duracion: 0.25 },
    { pitch: 38, velocidad: 90, inicio: 2, duracion: 0.25 },
  ]
  it('repite N compases y mantiene beats', () => {
    const r = construirNotasDeGroove(m, notas, { compases: 4 })
    expect(r.notas).toHaveLength(8)
    expect(r.duracion).toBe(16)
  })
  it('sustituye el último compás por un fill', () => {
    const r = construirNotasDeGroove(m, notas, {
      compases: 4,
      fillFinal: { compases: 1, notas: [{ pitch: 45, velocidad: 100, inicio: 0, duracion: 0.2 }] },
    })
    expect(r.notas.filter((n) => n.inicio >= 12).map((n) => n.pitch)).toEqual([45])
    expect(r.notas).toHaveLength(7)
  })
  it('escala al tempo del proyecto solo si se pide y avisa del compás distinto', () => {
    const r = construirNotasDeGroove(m, notas, { escalarAlTempo: true, tempoProyecto: 50, compasProyecto: { numerador: 3, denominador: 4 } })
    expect(r.duracion).toBe(2)
    expect(r.aviso).toMatch(/no coinciden/)
  })
  it('la variación ligera es determinista', () => {
    const a = construirNotasDeGroove(m, notas, { variacion: 'ligera', semilla: 5 })
    const b = construirNotasDeGroove(m, notas, { variacion: 'ligera', semilla: 5 })
    expect(a).toEqual(b)
  })
  it('lee el midi escrito', () => {
    const bin = escribirSmf({
      bpm: 88,
      compas: { numerador: 6, denominador: 8 },
      pistas: [
        {
          nombre: 'd',
          canal: 9,
          notas: [
            { pitch: 36, velocidad: 100, inicio: 0, duracion: 0.25 },
            { pitch: 38, velocidad: 90, inicio: 2.5, duracion: 0.5 },
          ],
        },
      ],
    })
    const { datos, notas: n } = datosDeCancion(leerSmf(bin))
    expect(datos.bpm).toBeCloseTo(88)
    expect(datos.compas).toEqual({ numerador: 6, denominador: 8 })
    expect(n).toHaveLength(2)
  })
})

describe('grooves · aplicarDiferencias', () => {
  const e = (id: string, revision = 1, sha = id, ruta = `X/${id}.mid`) => ({ id, ruta, sha256: sha, revision })
  it('decide qué descargar, actualizar y borrar', () => {
    const local = { grooves: [e('a'), e('b'), e('c')] }
    const remoto = { grooves: [e('a'), e('b', 2, 'nuevo'), e('d')] }
    const d = aplicarDiferencias(local, remoto)
    expect(d.sinCambios).toEqual(['a'])
    expect(d.actualizar.map((x) => x.nuevo.id)).toEqual(['b'])
    expect(d.descargar.map((x) => x.id)).toEqual(['d'])
    expect(d.borrar.map((x) => x.id)).toEqual(['c'])
  })
  it('no pisa un archivo del usuario en la misma ruta', () => {
    const d = aplicarDiferencias({ grooves: [] }, { grooves: [e('d')] }, { rutasOcupadas: ['x/D.mid'] })
    expect(d.descargar[0]!.ruta).toBe('X/d-catalogo.mid')
  })
  it('detecta cambios solo de ruta o de hash con la misma revisión', () => {
    expect(aplicarDiferencias({ grooves: [e('a')] }, { grooves: [e('a', 1, 'otro')] }).actualizar).toHaveLength(1)
    expect(aplicarDiferencias({ grooves: [e('a')] }, { grooves: [e('a', 1, 'a', 'Y/a.mid')] }).actualizar).toHaveLength(1)
  })
})
