import { useState } from 'react'
import { Boton, validarProcedimiento } from '@jaswave/host-sdk'
import type { ProcedimientoHabilidad, ResultadoCompilacion } from '@jaswave/host-sdk'
import { Cpu, Loader2, Save, Trash2, X } from 'lucide-react'

import { catalogoHerramientasAgente, compilarHabilidadConModelo } from '../motor/especialistas-habilidades'
import { describeActionForUser } from '../motor/describe-action'
import { DetallesTecnicos, textoTecnico } from './detalles-tecnicos'

function nombrePaso(paso: { herramienta: string; payload?: unknown }): string {
  const payload = paso.payload && typeof paso.payload === 'object' ? (paso.payload as Record<string, unknown>) : {}
  return describeActionForUser({ type: paso.herramienta, payload }).label
}

const ORIGEN: Record<ResultadoCompilacion['origen'], string> = {
  modelo: 'creada por la IA',
  local: 'creada con las reglas del programa',
  mixto: 'creada por la IA y revisada',
}

/**
 * Habilidades ejecutables de un especialista: el usuario la describe en lenguaje natural, se compila
 * a pasos con herramientas reales del DAW y la revisa antes de guardarla.
 */
export function HabilidadesEjecutables({
  procedimientos,
  onChange,
}: {
  procedimientos: ProcedimientoHabilidad[]
  onChange: (procs: ProcedimientoHabilidad[]) => void
}) {
  const [texto, setTexto] = useState('')
  const [compilando, setCompilando] = useState(false)
  const [borrador, setBorrador] = useState<ResultadoCompilacion | null>(null)

  const compilar = async () => {
    if (!texto.trim() || compilando) return
    setCompilando(true)
    try {
      setBorrador(await compilarHabilidadConModelo(texto.trim()))
    } finally {
      setCompilando(false)
    }
  }

  const quitarPaso = (i: number) => {
    const p = borrador?.procedimiento
    if (!p) return
    const pasos = p.pasos.filter((_, j) => j !== i)
    const r = validarProcedimiento({ ...p, pasos, instruccionesModelo: '' }, catalogoHerramientasAgente(), { textoUsuario: p.descripcionOriginal })
    setBorrador({ ...borrador!, procedimiento: r.procedimiento, avisos: r.procedimiento ? borrador!.avisos : r.avisos })
  }

  const guardar = () => {
    const p = borrador?.procedimiento
    if (!p) return
    onChange([...procedimientos.filter((x) => x.id !== p.id), p])
    setBorrador(null)
    setTexto('')
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-border/70 bg-panel-raised/50 p-2">
      <span className="flex items-center gap-1 text-[10px] font-medium text-foreground/80">
        <Cpu className="size-3 text-primary" /> Habilidades ejecutables ({procedimientos.length})
      </span>

      {procedimientos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {procedimientos.map((p) => (
            <li key={p.id} className="flex items-start gap-1.5 rounded border border-border/60 bg-panel-base/70 px-1.5 py-1 text-[10px]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground">{p.nombre}</div>
                <div className="truncate text-[9px] text-muted-foreground">
                  {p.pasos.length === 1 ? '1 paso' : `${p.pasos.length} pasos`}: {p.pasos.map((s) => nombrePaso(s)).join(', luego ')}
                </div>
              </div>
              <button
                type="button"
                title="Eliminar habilidad"
                aria-label={`Eliminar habilidad ${p.nombre}`}
                onClick={() => onChange(procedimientos.filter((x) => x.id !== p.id))}
                className="rounded p-0.5 text-red-400 hover:bg-red-500/10"
              >
                <Trash2 className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <textarea
        rows={3}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Describe la habilidad con tus palabras. Ej.: Analiza mis grabaciones MIDI (micro-tiempos y dinámica de cada nota) y aplica mi toque a las melodías nuevas de cada instrumento."
        className="w-full rounded border border-border bg-panel-raised p-1.5 text-[10px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <div className="flex justify-end">
        <Boton onClick={() => void compilar()} disabled={!texto.trim() || compilando}>
          {compilando ? <Loader2 className="mr-1 inline size-3 animate-spin" /> : <Cpu className="mr-1 inline size-3" />}
          {compilando ? 'Preparando…' : 'Preparar habilidad'}
        </Boton>
      </div>

      {borrador && (
        <div className="flex flex-col gap-1 rounded border border-primary/40 bg-panel-base/90 p-2 text-[10px]">
          {borrador.procedimiento ? (
            <>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  aria-label="Nombre de la habilidad"
                  value={borrador.procedimiento.nombre}
                  onChange={(e) => setBorrador({ ...borrador, procedimiento: { ...borrador.procedimiento!, nombre: e.target.value } })}
                  className="flex-1 rounded border border-border bg-panel-raised px-1.5 py-0.5 font-semibold text-foreground"
                />
                <span className="text-[9px] text-muted-foreground">{ORIGEN[borrador.origen]}</span>
              </div>
              <p className="text-muted-foreground">{borrador.procedimiento.objetivo}</p>
              <ol className="flex flex-col gap-1">
                {borrador.procedimiento.pasos.map((paso, i) => (
                  <li key={`${paso.herramienta}-${i}`} className="flex items-start gap-1.5 rounded bg-panel-raised/60 px-1.5 py-1">
                    <span className="text-primary">{i + 1}.</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-foreground">
                        {nombrePaso(paso)}
                        {paso.repetir === 'porPistaMidi' ? <span className="ml-1 text-amber-300">· por cada instrumento</span> : null}
                        {paso.pista ? <span className="ml-1 text-sky-300">· en {paso.pista}</span> : null}
                      </div>
                      <div className="text-muted-foreground">{paso.motivo}</div>
                      <DetallesTecnicos className="text-[9px] text-muted-foreground/60">
                        {`${paso.herramienta}\n${textoTecnico(paso.payload, 400)}`}
                      </DetallesTecnicos>
                    </div>
                    <button type="button" title="Quitar paso" aria-label={`Quitar paso ${i + 1}`} onClick={() => quitarPaso(i)} className="text-muted-foreground hover:text-red-400">
                      <X className="size-3" />
                    </button>
                  </li>
                ))}
              </ol>
              {borrador.procedimiento.variables?.length ? (
                <div className="text-muted-foreground">
                  La IA decidirá en cada uso: {borrador.procedimiento.variables.map((v) => `${v.nombre} (${v.descripcion})`).join('; ')}
                </div>
              ) : null}
              <div className="text-muted-foreground">Se activa con: {borrador.procedimiento.disparadores.join(', ') || 'cuando lo pidas'}</div>
            </>
          ) : (
            <p className="text-amber-300">No pude convertir la descripción en pasos que el programa sepa hacer. Descríbela con acciones concretas (analizar, aplicar, cuantizar…).</p>
          )}
          {borrador.avisos.length > 0 && (
            <ul className="list-disc pl-4 text-[9px] text-amber-300/90">
              {borrador.avisos.slice(0, 6).map((a, i) => (
                <li key={i}>{a}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-1.5">
            <Boton onClick={() => setBorrador(null)}>Descartar</Boton>
            <Boton onClick={guardar} disabled={!borrador.procedimiento?.pasos.length}>
              <Save className="mr-1 inline size-3" /> Guardar habilidad
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}
