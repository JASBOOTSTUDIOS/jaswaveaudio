import { describe, expect, it } from 'vitest'
import {
  detectarConflictoDisco,
  hayConflictoDisco,
  mensajeConflictoDisco,
  mismaFirma,
  type FirmaArchivo,
} from '../project/conflicto-disco'

const firma = (mtimeMs: number, size = 100): FirmaArchivo => ({ mtimeMs, size })

describe('conflicto-disco', () => {
  it('considera la misma firma si mtime y tamaño coinciden', () => {
    expect(mismaFirma(firma(1000), firma(1000))).toBe(true)
    expect(mismaFirma(firma(1000, 10), firma(1000, 11))).toBe(false)
    expect(mismaFirma(firma(1000), firma(1001))).toBe(false)
  })

  it('tolera la diferencia de precisión sub-milisegundo', () => {
    expect(mismaFirma(firma(1000.4), firma(1000.2))).toBe(true)
  })

  it('no hay conflicto si nunca se conoce la firma', () => {
    expect(hayConflictoDisco(null, firma(1000))).toBe(false)
    expect(hayConflictoDisco(undefined, firma(1000))).toBe(false)
  })

  it('no hay conflicto si el archivo ya no existe (se recrea al guardar)', () => {
    expect(hayConflictoDisco(firma(1000), null)).toBe(false)
    expect(hayConflictoDisco(firma(1000), undefined)).toBe(false)
  })

  it('hay conflicto si cambian mtime o tamaño', () => {
    expect(hayConflictoDisco(firma(1000), firma(2000))).toBe(true)
    expect(hayConflictoDisco(firma(1000, 10), firma(1000, 20))).toBe(true)
  })

  it('detectarConflictoDisco devuelve el detalle o null', () => {
    const conflicto = detectarConflictoDisco('C:/p.jaswave', firma(1000), firma(2000))
    expect(conflicto?.ruta).toBe('C:/p.jaswave')
    expect(conflicto?.esperado.mtimeMs).toBe(1000)
    expect(conflicto?.actual.mtimeMs).toBe(2000)
    expect(detectarConflictoDisco('C:/p.jaswave', firma(1000), firma(1000))).toBeNull()
  })

  it('el mensaje nombra el archivo', () => {
    const conflicto = detectarConflictoDisco('C:/p.jaswave', firma(1000), firma(2000))!
    expect(mensajeConflictoDisco(conflicto)).toContain('C:/p.jaswave')
    expect(mensajeConflictoDisco(conflicto)).toContain('cambió en disco')
  })
})
