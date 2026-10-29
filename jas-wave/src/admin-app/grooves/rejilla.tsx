/**
 * Mini-vista de la rejilla rítmica de un groove (la misma matriz con la que se compara): una fila por pieza
 * (bombo, caja, hi-hat…) y una columna por paso. Con `contra` pinta las diferencias: en cian lo que coincide,
 * en ámbar lo que solo tiene este groove y en violeta lo que solo tiene el otro.
 */

import { FAMILIAS, huellaDeJson, rejillaDeHuella } from './shared'

const NOMBRE_FILA: Record<string, string> = { bombo: 'Bombo', caja: 'Caja', hihat: 'Hi-hat', ride: 'Ride', platos: 'Platos', toms: 'Toms', percusion: 'Perc.' }

type Aplanada = { filas: Uint8Array[]; pasos: number; compases: number }

/** Une los compases del periodo en filas continuas (una por pieza). */
export function aplanarHuella(huella: unknown): Aplanada | null {
  const h = huellaDeJson(huella)
  if (!h) return null
  const rej = rejillaDeHuella(h)
  const filas = FAMILIAS.map((_, f) => {
    const fila = new Uint8Array(rej.length * h.pasos)
    rej.forEach((compas, c) => fila.set(compas[f]!, c * h.pasos))
    return fila
  })
  return { filas, pasos: h.pasos, compases: rej.length }
}

export function RejillaRitmica({ huella, contra, lado = 'a', compacta, etiqueta }: { huella: unknown; contra?: unknown; lado?: 'a' | 'b'; compacta?: boolean; etiqueta?: string }) {
  const a = aplanarHuella(huella)
  if (!a) return <p className="text-[12px] text-cy-apagado">Sin datos rítmicos.</p>
  const otro = contra ? aplanarHuella(contra) : null
  const largo = otro ? Math.max(a.filas[0]!.length, otro.filas[0]!.length) : a.filas[0]!.length
  const celda = compacta ? 6 : 10
  return (
    <div role="img" aria-label={etiqueta ?? 'Rejilla rítmica'} className="overflow-x-auto" data-testid="rejilla-ritmica">
      <div className="inline-grid gap-px" style={{ gridTemplateColumns: `${compacta ? '0px' : '42px'} repeat(${largo}, ${celda}px)` }}>
        {FAMILIAS.map((fam, f) => {
          const fila = a.filas[f]!
          const filaOtro = otro?.filas[f]
          // Se omiten las piezas que no suenan en ninguno de los dos.
          const hay = fila.some(Boolean) || filaOtro?.some(Boolean)
          if (!hay) return null
          return [
            <span key={`n${fam}`} className={`pr-1 text-right text-[9px] uppercase tracking-wider text-cy-apagado ${compacta ? 'hidden' : ''}`} style={{ lineHeight: `${celda + 2}px` }}>
              {NOMBRE_FILA[fam]}
            </span>,
            ...Array.from({ length: largo }, (_, s) => {
              const mio = s < fila.length ? fila[s]! : 0
              const suyo = filaOtro && s < filaOtro.length ? filaOtro[s]! : 0
              let color = 'bg-cy-borde/40'
              if (otro) {
                if (mio && suyo) color = 'bg-cy-cian'
                else if (mio) color = lado === 'a' ? 'bg-cy-ambar' : 'bg-[#b994ff]'
                else if (suyo) color = lado === 'a' ? 'bg-[#b994ff]' : 'bg-cy-ambar'
              } else if (mio) color = mio === 3 ? 'bg-cy-cian' : mio === 2 ? 'bg-cy-cian/70' : 'bg-cy-cian/40'
              const inicioCompas = s % a.pasos === 0
              return <span key={`${fam}${s}`} className={`rounded-[1px] ${color} ${inicioCompas ? 'ml-0.5' : ''}`} style={{ height: celda, width: celda }} />
            }),
          ]
        })}
      </div>
    </div>
  )
}
