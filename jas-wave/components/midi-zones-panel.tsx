/**
 * Panel «Zonas MIDI» (K3): splits, capas y transposición del teclado para tocar en directo. Teclado de 88
 * teclas con las zonas pintadas (arrastre de límites), lista editable (rango, transposición, curva de
 * velocidad, canales, pista destino) y seguridad del máster. Toda mutación pasa por comandos (undo).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { KeyboardMusic, Plus, Trash2 } from 'lucide-react'
import { useDAW, useDAWState } from '@/src/context/daw-context'
import { Button } from '@/components/ui/button'
import { getSelectedTrackId } from '@/src/lib/selection-helpers'
import { isMidiLikeTrack } from '@/src/lib/midi-track-io'
import { CURVAS_VELOCIDAD, type CurvaVelocidad, type ZonaMidi } from '../../shared/src/types/directo'

const NOTA_MIN = 21 // A0
const NOTA_MAX = 108 // C8
const TECLAS = NOTA_MAX - NOTA_MIN + 1
const NOMBRES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const COLORES = ['#22d3ee', '#f59e0b', '#a78bfa', '#34d399', '#fb7185', '#60a5fa', '#facc15', '#f472b6']
const ETIQUETA_CURVA: Record<CurvaVelocidad, string> = { lineal: 'Lineal', suave: 'Suave', dura: 'Dura', fija: 'Fija' }

export function nombreNota(n: number): string {
  return `${NOMBRES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`
}

function esNegra(n: number): boolean {
  return [1, 3, 6, 8, 10].includes(((n % 12) + 12) % 12)
}

export function MidiZonesPanel() {
  const tienda = useDAW()
  const zonas = useDAWState((s) => s.project?.directo?.zonas ?? [])
  const seguridad = useDAWState((s) => s.project?.directo?.seguridad)
  const tracks = useDAWState((s) => s.project?.tracks ?? [])
  const seleccionada = useDAWState((s) => getSelectedTrackId(s))
  const pistasMidi = useMemo(() => tracks.filter((t) => isMidiLikeTrack(t.tipo)), [tracks])
  const colorDe = useCallback((zonaId: string) => COLORES[Math.max(0, zonas.findIndex((z) => z.id === zonaId)) % COLORES.length]!, [zonas])
  const nombrePista = useCallback((id: string) => tracks.find((t) => t.id === id)?.nombre ?? '(pista borrada)', [tracks])

  const ejecutar = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      void tienda.executor.execute(type, payload, 'user')
    },
    [tienda],
  )
  const actualizar = useCallback(
    (zonaId: string, cambios: Partial<Omit<ZonaMidi, 'id'>>) => ejecutar('midi.zones.update', { zonaId, cambios }),
    [ejecutar],
  )

  const anadir = () => {
    const pistaId = (seleccionada && pistasMidi.some((t) => t.id === seleccionada) ? seleccionada : pistasMidi[0]?.id) ?? null
    if (!pistaId) return
    const propias = zonas.filter((z) => z.pistaId === pistaId)
    // La primera zona de una pista cubre el teclado; la siguiente parte el teclado en C4 (split).
    const payload = propias.length === 0 ? { pistaId, lo: NOTA_MIN, hi: NOTA_MAX } : { pistaId, lo: 60, hi: NOTA_MAX }
    ejecutar('midi.zones.add', payload)
  }

  // Arrastre de límites sobre el teclado: estado local durante el gesto y un solo comando al soltar.
  const tecladoRef = useRef<HTMLDivElement>(null)
  const [arrastre, setArrastre] = useState<{ zonaId: string; lado: 'lo' | 'hi'; valor: number } | null>(null)
  const notaDesdeX = useCallback((clientX: number) => {
    const r = tecladoRef.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return NOTA_MIN
    const i = Math.floor(((clientX - r.left) / r.width) * TECLAS)
    return Math.max(NOTA_MIN, Math.min(NOTA_MAX, NOTA_MIN + i))
  }, [])
  useEffect(() => {
    if (!arrastre) return
    const onMove = (e: PointerEvent) => setArrastre((a) => (a ? { ...a, valor: notaDesdeX(e.clientX) } : a))
    const onUp = (e: PointerEvent) => {
      const valor = notaDesdeX(e.clientX)
      const z = zonas.find((x) => x.id === arrastre.zonaId)
      if (z) {
        const cambios = arrastre.lado === 'lo' ? { lo: Math.min(valor, z.hi) } : { hi: Math.max(valor, z.lo) }
        actualizar(z.id, cambios)
      }
      setArrastre(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [arrastre, zonas, actualizar, notaDesdeX])

  const pct = (n: number) => `${((n - NOTA_MIN) / TECLAS) * 100}%`
  const rangoVisible = (z: ZonaMidi) => {
    let { lo, hi } = z
    if (arrastre?.zonaId === z.id) {
      if (arrastre.lado === 'lo') lo = Math.min(arrastre.valor, hi)
      else hi = Math.max(arrastre.valor, lo)
    }
    return { lo: Math.max(NOTA_MIN, lo), hi: Math.min(NOTA_MAX, hi) }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-panel" data-testid="zonas-panel">
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <KeyboardMusic className="size-4 text-accent-amber" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Zonas MIDI</h2>
          <p className="text-[11px] text-muted-foreground">
            Divide el teclado por pistas (split), apila capas y transpone sin latencia añadida: el host aplica las zonas en el
            hilo de audio. Arrastra los bordes de cada zona sobre el teclado.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={anadir} disabled={pistasMidi.length === 0} data-testid="zona-anadir">
          <Plus className="size-3.5" /> Añadir zona
        </Button>
      </div>

      <div className="shrink-0 border-b border-border px-4 py-3">
        <div ref={tecladoRef} className="relative h-20 select-none overflow-hidden rounded-md border border-border bg-zinc-900" data-testid="zonas-teclado">
          <div className="absolute inset-0 flex">
            {Array.from({ length: TECLAS }, (_, i) => NOTA_MIN + i).map((n) => (
              <div
                key={n}
                className={`h-full flex-1 border-r border-zinc-700/60 ${esNegra(n) ? 'bg-zinc-800' : 'bg-zinc-200'}`}
                title={nombreNota(n)}
              />
            ))}
          </div>
          {zonas.map((z, i) => {
            const { lo, hi } = rangoVisible(z)
            const color = COLORES[i % COLORES.length]!
            const alto = 100 / Math.max(1, Math.min(4, zonas.length))
            return (
              <div
                key={z.id}
                className="absolute flex items-center justify-between rounded-sm text-[10px] font-semibold text-black"
                style={{
                  left: pct(lo),
                  width: `calc(${pct(hi + 1)} - ${pct(lo)})`,
                  top: `${(i % 4) * alto}%`,
                  height: `${alto}%`,
                  backgroundColor: `${color}${z.activa ? 'b3' : '40'}`,
                }}
                title={`${nombrePista(z.pistaId)} · ${nombreNota(lo)}–${nombreNota(hi)}${z.transposicion ? ` · ${z.transposicion > 0 ? '+' : ''}${z.transposicion} st` : ''}`}
                data-testid="zona-banda"
              >
                <button
                  type="button"
                  aria-label={`Límite grave de ${nombrePista(z.pistaId)}`}
                  className="h-full w-2 cursor-ew-resize rounded-l-sm bg-black/30 hover:bg-black/50"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    setArrastre({ zonaId: z.id, lado: 'lo', valor: lo })
                  }}
                />
                <span className="truncate px-1">{nombrePista(z.pistaId)}</span>
                <button
                  type="button"
                  aria-label={`Límite agudo de ${nombrePista(z.pistaId)}`}
                  className="h-full w-2 cursor-ew-resize rounded-r-sm bg-black/30 hover:bg-black/50"
                  onPointerDown={(e) => {
                    e.preventDefault()
                    setArrastre({ zonaId: z.id, lado: 'hi', valor: hi })
                  }}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
          <span>{nombreNota(NOTA_MIN)}</span>
          <span>C4 = 60</span>
          <span>{nombreNota(NOTA_MAX)}</span>
        </div>
      </div>

      <div className="jw-scrollbar min-h-0 flex-1 overflow-y-auto">
        {zonas.length === 0 ? (
          <p className="px-4 py-6 text-center text-[12px] text-muted-foreground" data-testid="zonas-vacio">
            Sin zonas: cada pista monitorizada recibe el teclado completo. Pulsa «Añadir zona» para hacer un split (p. ej. bajo a la
            izquierda, piano a la derecha) o una capa (dos pistas con el mismo rango).
          </p>
        ) : (
          zonas.map((z) => (
            <div key={z.id} className="flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2 text-[11px]" data-testid="zona-item" data-zona-id={z.id}>
              <span className="size-3 shrink-0 rounded-sm" style={{ backgroundColor: colorDe(z.id) }} aria-hidden />
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Pista</span>
                <select
                  value={z.pistaId}
                  onChange={(e) => actualizar(z.id, { pistaId: e.target.value })}
                  className="rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Pista destino"
                  data-testid="zona-pista"
                >
                  {!pistasMidi.some((t) => t.id === z.pistaId) ? <option value={z.pistaId}>{nombrePista(z.pistaId)}</option> : null}
                  {pistasMidi.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.nombre}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">De</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={z.lo}
                  onChange={(e) => actualizar(z.id, { lo: Number(e.target.value) })}
                  className="w-14 rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Nota más grave"
                  title={nombreNota(z.lo)}
                  data-testid="zona-lo"
                />
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">a</span>
                <input
                  type="number"
                  min={0}
                  max={127}
                  value={z.hi}
                  onChange={(e) => actualizar(z.id, { hi: Number(e.target.value) })}
                  className="w-14 rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Nota más aguda"
                  title={nombreNota(z.hi)}
                  data-testid="zona-hi"
                />
              </label>
              <span className="text-muted-foreground">
                {nombreNota(z.lo)}–{nombreNota(z.hi)}
              </span>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Transp.</span>
                <input
                  type="number"
                  min={-60}
                  max={60}
                  value={z.transposicion}
                  onChange={(e) => actualizar(z.id, { transposicion: Number(e.target.value) })}
                  className="w-14 rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Transposición en semitonos"
                  data-testid="zona-transposicion"
                />
                <span className="text-muted-foreground">st</span>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Velocidad</span>
                <select
                  value={z.curvaVelocidad}
                  onChange={(e) => actualizar(z.id, { curvaVelocidad: e.target.value as CurvaVelocidad })}
                  className="rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Curva de velocidad"
                  data-testid="zona-curva"
                >
                  {CURVAS_VELOCIDAD.map((c) => (
                    <option key={c} value={c}>
                      {ETIQUETA_CURVA[c]}
                    </option>
                  ))}
                </select>
                {z.curvaVelocidad === 'fija' ? (
                  <input
                    type="number"
                    min={1}
                    max={127}
                    value={z.velocidadFija}
                    onChange={(e) => actualizar(z.id, { velocidadFija: Number(e.target.value) })}
                    className="w-12 rounded bg-panel-raised px-1 py-0.5 text-foreground"
                    aria-label="Velocidad fija"
                  />
                ) : (
                  <input
                    type="number"
                    min={0}
                    max={400}
                    step={5}
                    value={Math.round(z.escalaVelocidad * 100)}
                    onChange={(e) => actualizar(z.id, { escalaVelocidad: Number(e.target.value) / 100 })}
                    className="w-14 rounded bg-panel-raised px-1 py-0.5 text-foreground"
                    aria-label="Escala de velocidad en porcentaje"
                    title="Escala de velocidad (%)"
                  />
                )}
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted-foreground">Canal</span>
                <select
                  value={z.canalEntrada ?? 0}
                  onChange={(e) => actualizar(z.id, { canalEntrada: Number(e.target.value) || undefined })}
                  className="rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Canal de entrada"
                >
                  <option value={0}>todos</option>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">→</span>
                <select
                  value={z.canalSalida ?? 0}
                  onChange={(e) => actualizar(z.id, { canalSalida: Number(e.target.value) || undefined })}
                  className="rounded bg-panel-raised px-1 py-0.5 text-foreground"
                  aria-label="Canal de salida"
                >
                  <option value={0}>igual</option>
                  {Array.from({ length: 16 }, (_, i) => i + 1).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-pressed={z.activa}
                onClick={() => actualizar(z.id, { activa: !z.activa })}
                className={`rounded px-1.5 py-0.5 ${z.activa ? 'bg-accent-cyan/20 text-accent-cyan' : 'bg-panel-raised text-muted-foreground'}`}
                title={z.activa ? 'Zona activa (clic para desactivar)' : 'Zona desactivada (clic para activar)'}
                data-testid="zona-activa"
              >
                {z.activa ? 'ON' : 'OFF'}
              </button>
              <button
                type="button"
                aria-label="Quitar zona"
                onClick={() => ejecutar('midi.zones.remove', { zonaId: z.id })}
                className="ml-auto rounded p-1 text-muted-foreground hover:bg-panel-raised hover:text-rose-400"
                data-testid="zona-quitar"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-border px-4 py-2 text-[11px]" data-testid="zonas-seguridad">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={seguridad?.activa === true}
            onChange={(e) => ejecutar('directo.setSafety', { activa: e.target.checked })}
            aria-label="Limitador true-peak del máster"
          />
          <span className="text-foreground">Seguridad del máster (limitador true-peak)</span>
        </label>
        <label className="flex items-center gap-1">
          <span className="text-muted-foreground">Techo</span>
          <input
            type="number"
            min={-24}
            max={0}
            step={0.1}
            value={seguridad?.techoDb ?? -0.5}
            onChange={(e) => {
              const v = Number(e.target.value)
              if (Number.isFinite(v) && v <= 0 && v >= -24) ejecutar('directo.setSafety', { techoDb: v })
            }}
            className="w-16 rounded bg-panel-raised px-1 py-0.5 text-foreground"
            aria-label="Techo en dBTP"
          />
          <span className="text-muted-foreground">dBTP</span>
        </label>
        <span className="text-muted-foreground">Solo monitorización: no entra en un bounce. PANIC y el candado Directo están en el transporte.</span>
      </div>
    </div>
  )
}
