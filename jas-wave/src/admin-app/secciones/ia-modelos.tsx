/**
 * IA › Modelos JasWave: lo que ven los usuarios («JasWave Rápido/Creativo/Profundo»). Cada modelo tiene
 * nombre y descripción editables en línea y una cadena ordenada de eslabones (conexión, modelo real y
 * razonamiento) que el servidor recorre como cobertura. «JasWave Auto» (id `auto`) no tiene cadena: elige
 * el modelo según la tarea.
 */

import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Play, Plus, RefreshCw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { DatosModeloJasWave, EslabonModeloJasWave, ModeloJasWaveAdmin, ProveedorIAApi, PruebaEslabonIA, RazonamientoIA } from '@/src/lib/backend/api'
import { mensaje, milisegundos, useEjecutar, useRecurso } from '../datos'
import type { IdSeccion } from '../navegacion'
import { Boton, BotonIcono, CabeceraSeccion, Campo, Cargando, Hoja, Insignia, Interruptor, Led, MensajeError, Nota, TextoEditable, Vacio } from '../ui'
import { NavIA } from './ia-nav'

const RAZONAMIENTOS: { id: RazonamientoIA; texto: string }[] = [
  { id: 'off', texto: 'Sin' },
  { id: 'bajo', texto: 'Bajo' },
  { id: 'normal', texto: 'Normal' },
]

const ID_AUTO = 'auto'

type Borrador = DatosModeloJasWave & { creditosPorMil: number; maxTokens: number; activo: boolean }

const aBorrador = (m: ModeloJasWaveAdmin): Borrador => ({
  nombre: m.nombre,
  descripcion: m.descripcion,
  activo: m.activo,
  cadena: m.cadena.map((e) => ({ ...e })),
  creditosPorMil: m.creditosPorMil,
  maxTokens: m.maxTokens,
})

export function SeccionModelos({ onIr }: { onIr: (s: IdSeccion) => void }) {
  const { datos, error, cargando, recargar } = useRecurso(async () => {
    const api = apiJasWave().admin.ia
    const [modelos, conexiones] = await Promise.all([api.modelos(), api.proveedores()])
    return { modelos, conexiones }
  })
  const [creando, setCreando] = useState(false)

  return (
    <>
      <CabeceraSeccion
        rotulo="Inteligencia artificial"
        titulo="Modelos JasWave"
        descripcion="Los modelos que ven los usuarios. Cada uno recorre su cadena de conexiones en orden si una falla."
        acciones={
          <>
            <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
              <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
            </BotonIcono>
            <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setCreando(true)}>
              Nuevo modelo
            </Boton>
          </>
        }
      />
      <NavIA actual="ia-modelos" onIr={onIr} />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {!datos && cargando ? <Cargando /> : null}
      {datos && datos.modelos.length === 0 ? <Vacio icono={<Sparkles className="size-6" />} titulo="Aún no hay modelos JasWave." /> : null}
      {datos ? (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {datos.modelos.map((m) => (
            <TarjetaModelo key={m.id} modelo={m} conexiones={datos.conexiones} recargar={recargar} />
          ))}
        </div>
      ) : null}
      <NuevoModelo abierto={creando} onCerrar={() => setCreando(false)} existentes={datos?.modelos.map((m) => m.id) ?? []} alCrear={recargar} />
    </>
  )
}

function TarjetaModelo({ modelo, conexiones, recargar }: { modelo: ModeloJasWaveAdmin; conexiones: ProveedorIAApi[]; recargar: () => Promise<void> }) {
  const ejecutar = useEjecutar()
  const esAuto = modelo.id === ID_AUTO
  const [b, setB] = useState<Borrador>(() => aBorrador(modelo))
  const [guardando, setGuardando] = useState(false)
  const [prueba, setPrueba] = useState<{ cargando: boolean; resultados?: PruebaEslabonIA[]; error?: string } | null>(null)
  useEffect(() => setB(aBorrador(modelo)), [modelo])

  const original = useMemo(() => JSON.stringify(aBorrador(modelo)), [modelo])
  const sucio = JSON.stringify(b) !== original
  const porId = useMemo(() => new Map(conexiones.map((c) => [c.id, c])), [conexiones])
  const cambiar = (p: Partial<Borrador>) => setB((x) => ({ ...x, ...p }))
  const cambiarEslabon = (i: number, p: Partial<EslabonModeloJasWave>) => cambiar({ cadena: b.cadena.map((e, j) => (j === i ? { ...e, ...p } : e)) })
  const mover = (i: number, d: -1 | 1) => {
    const c = [...b.cadena]
    ;[c[i], c[i + d]] = [c[i + d], c[i]]
    cambiar({ cadena: c })
  }
  const anadir = () => {
    const c = conexiones.find((x) => x.activo && x.modelos.length) ?? conexiones[0]
    if (!c) return
    cambiar({ cadena: [...b.cadena, { proveedorId: c.id, modelo: c.modeloPorDefecto || c.modelos[0] || '', razonamiento: 'off' }] })
  }

  const guardar = async () => {
    if (!b.nombre.trim()) return
    setGuardando(true)
    const datos: DatosModeloJasWave = esAuto
      ? { nombre: b.nombre.trim(), descripcion: b.descripcion.trim(), activo: b.activo, cadena: [] }
      : { ...b, nombre: b.nombre.trim(), descripcion: b.descripcion.trim() }
    const ok = await ejecutar(() => apiJasWave().admin.ia.guardarModelo(modelo.id, datos), `«${b.nombre.trim()}» guardado.`)
    setGuardando(false)
    if (ok) await recargar()
  }

  const probar = async () => {
    setPrueba({ cargando: true })
    try {
      setPrueba({ cargando: false, resultados: await apiJasWave().admin.ia.probarModelo(modelo.id) })
    } catch (e) {
      setPrueba({ cargando: false, error: mensaje(e) })
    }
  }

  const resultadoDe = (e: EslabonModeloJasWave) => prueba?.resultados?.find((r) => r.conexionId === e.proveedorId && r.modelo === e.modelo && r.razonamiento === e.razonamiento)
  const estadoLed = !b.activo ? 'apagado' : !esAuto && b.cadena.length === 0 ? 'aviso' : 'ok'

  return (
    <article className={`cy-panel min-w-0 ${sucio ? 'cy-panel-activo' : ''}`}>
      <header className="border-b border-cy-borde/50 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <Led estado={estadoLed} titulo={!b.activo ? 'Desactivado' : estadoLed === 'aviso' ? 'Sin cadena: no responde' : 'Operativo'} />
          <div className="min-w-0 flex-1">
            <TextoEditable etiqueta="Nombre visible" valor={b.nombre} onCambiar={(v) => cambiar({ nombre: v })} maxLength={60} placeholder="Nombre del modelo" className="text-[18px] font-light tracking-wide text-cy-texto" />
          </div>
        </div>
        <div className="pl-5">
          <TextoEditable etiqueta="Descripción visible" valor={b.descripcion} onCambiar={(v) => cambiar({ descripcion: v })} maxLength={200} placeholder="Descripción breve para los usuarios" className="mt-0.5 text-[12.5px] text-cy-tenue" />
          <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
            <Insignia mono>{modelo.id}</Insignia>
            {esAuto ? <Insignia tono="violeta">virtual</Insignia> : null}
            <span className="ml-auto flex items-center gap-1">
              {!esAuto ? (
                <BotonIcono
                  etiqueta={`Eliminar ${modelo.nombre}`}
                  peligro
                  onClick={() => {
                    if (window.confirm(`¿Eliminar el modelo «${modelo.nombre}»? Los usuarios dejarán de verlo.`))
                      void ejecutar(() => apiJasWave().admin.ia.eliminarModelo(modelo.id), 'Modelo eliminado.').then((ok) => {
                        if (ok) void recargar()
                      })
                  }}
                >
                  <Trash2 className="size-4" />
                </BotonIcono>
              ) : null}
              <Interruptor activo={b.activo} onCambiar={(v) => cambiar({ activo: v })} etiqueta={`Activo ${modelo.nombre}`} />
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {esAuto ? (
          <Nota>
            <Wand2 className="mr-1.5 inline size-3.5 text-cy-cian" />
            Elige el modelo según la tarea: usa los demás modelos JasWave activos, sin cadena propia.
          </Nota>
        ) : (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="cy-rotulo">Cadena · {b.cadena.length}</p>
                <span className="text-[11px] text-cy-apagado">se prueba en orden</span>
              </div>
              {b.cadena.length === 0 ? <p className="rounded-lg border border-dashed border-cy-ambar/40 px-3 py-3 text-[12px] text-cy-ambar">Sin eslabones: este modelo no puede responder.</p> : null}
              <ol className="flex flex-col gap-2">
                {b.cadena.map((e, i) => {
                  const cx = porId.get(e.proveedorId)
                  const modelosCx = cx?.modelos ?? []
                  const r = resultadoDe(e)
                  return (
                    <li key={i} className="rounded-xl border border-cy-borde/60 bg-cy-negro/50 p-2.5">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="grid size-6 shrink-0 place-items-center rounded-md border border-cy-borde font-mono text-[11px] text-cy-cian">{i + 1}</span>
                        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2">
                          <select aria-label={`Conexión del eslabón ${i + 1}`} value={e.proveedorId} onChange={(ev) => {
                            const n = porId.get(ev.target.value)
                            cambiarEslabon(i, { proveedorId: ev.target.value, modelo: n?.modelos.includes(e.modelo) ? e.modelo : (n?.modeloPorDefecto || n?.modelos[0] || '') })
                          }} className="cy-entrada min-h-11 md:min-h-8 md:py-1">
                            {!cx ? <option value={e.proveedorId}>Conexión eliminada</option> : null}
                            {conexiones.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.nombre}
                                {c.activo ? '' : ' (inactiva)'}
                              </option>
                            ))}
                          </select>
                          <select aria-label={`Modelo del eslabón ${i + 1}`} value={e.modelo} onChange={(ev) => cambiarEslabon(i, { modelo: ev.target.value })} className="cy-entrada min-h-11 font-mono text-[12px] md:min-h-8 md:py-1">
                            {!modelosCx.includes(e.modelo) ? <option value={e.modelo}>{e.modelo || '—'} (no habilitado)</option> : null}
                            {modelosCx.map((m) => (
                              <option key={m} value={m}>
                                {m}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 pl-8">
                        <div role="radiogroup" aria-label={`Razonamiento del eslabón ${i + 1}`} className="flex rounded-lg border border-cy-borde/70 p-0.5">
                          {RAZONAMIENTOS.map((rz) => (
                            <button
                              key={rz.id}
                              type="button"
                              role="radio"
                              aria-checked={e.razonamiento === rz.id}
                              onClick={() => cambiarEslabon(i, { razonamiento: rz.id })}
                              className={`min-h-9 rounded-md px-2.5 text-[10.5px] uppercase tracking-wider md:min-h-7 ${e.razonamiento === rz.id ? 'bg-cy-violeta/20 text-[#c7a6ff]' : 'text-cy-apagado hover:text-cy-tenue'}`}
                            >
                              {rz.texto}
                            </button>
                          ))}
                        </div>
                        <span className="text-[10.5px] uppercase tracking-wider text-cy-apagado">razonamiento</span>
                        {r ? (
                          <span className={`flex items-center gap-1.5 font-mono text-[11px] ${r.ok ? 'text-cy-ok' : 'text-cy-alerta'}`} title={r.error}>
                            <Led estado={r.ok ? 'ok' : 'error'} />
                            {r.ok ? milisegundos(r.ms) : 'falla'}
                          </span>
                        ) : null}
                        <span className="ml-auto flex">
                          <BotonIcono etiqueta="Subir" disabled={i === 0} onClick={() => mover(i, -1)}>
                            <ArrowUp className="size-4" />
                          </BotonIcono>
                          <BotonIcono etiqueta="Bajar" disabled={i === b.cadena.length - 1} onClick={() => mover(i, 1)}>
                            <ArrowDown className="size-4" />
                          </BotonIcono>
                          <BotonIcono etiqueta="Quitar eslabón" peligro onClick={() => cambiar({ cadena: b.cadena.filter((_, j) => j !== i) })}>
                            <X className="size-4" />
                          </BotonIcono>
                        </span>
                      </div>
                      {r && !r.ok && r.error ? <p className="mt-1.5 truncate pl-8 text-[11px] text-cy-alerta">{r.error}</p> : null}
                    </li>
                  )
                })}
              </ol>
              <Boton variante="fantasma" compacto className="mt-2" icono={<Plus className="size-4" />} disabled={!conexiones.length || b.cadena.length >= 12} onClick={anadir}>
                Añadir eslabón
              </Boton>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Campo etiqueta="Créditos / 1000 tokens" type="number" min={0} max={1000} step="0.1" mono value={b.creditosPorMil} onChange={(e) => cambiar({ creditosPorMil: Number(e.target.value) || 0 })} />
              <Campo etiqueta="Máx. tokens respuesta" type="number" min={256} max={64000} step={256} mono value={b.maxTokens} onChange={(e) => cambiar({ maxTokens: Math.round(Number(e.target.value) || 0) })} />
            </div>
          </>
        )}
        {prueba?.error ? <MensajeError>{prueba.error}</MensajeError> : null}
        {prueba?.resultados && prueba.resultados.length === 0 ? <p className="text-[12px] text-cy-ambar">Ningún eslabón operativo que probar (conexiones o claves inactivas).</p> : null}
      </div>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-cy-borde/50 px-4 py-3">
        {!esAuto ? (
          <Boton icono={<Play className="size-3.5" />} cargando={prueba?.cargando} onClick={() => void probar()} disabled={sucio} title={sucio ? 'Guarda los cambios antes de probar' : 'Prueba cada eslabón y mide su latencia'}>
            Probar
          </Boton>
        ) : null}
        <span className="flex-1" />
        {sucio ? (
          <Boton variante="fantasma" onClick={() => setB(aBorrador(modelo))}>
            Descartar
          </Boton>
        ) : null}
        <Boton variante="primario" disabled={!sucio || !b.nombre.trim() || (!esAuto && b.maxTokens < 256)} cargando={guardando} onClick={() => void guardar()}>
          Guardar
        </Boton>
      </footer>
    </article>
  )
}

function NuevoModelo({ abierto, onCerrar, existentes, alCrear }: { abierto: boolean; onCerrar: () => void; existentes: string[]; alCrear: () => Promise<void> }) {
  const ejecutar = useEjecutar()
  const [id, setId] = useState('')
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [enviando, setEnviando] = useState(false)
  const valido = /^[a-z][a-z0-9-]{1,30}$/.test(id)
  const repetido = existentes.includes(id)
  const cerrar = () => {
    setId('')
    setNombre('')
    setDescripcion('')
    onCerrar()
  }
  const crear = async () => {
    setEnviando(true)
    const ok = await ejecutar(() => apiJasWave().admin.ia.guardarModelo(id, { nombre: nombre.trim(), descripcion: descripcion.trim(), cadena: [], activo: false }), 'Modelo creado. Añade su cadena y actívalo.')
    setEnviando(false)
    if (ok) {
      await alCrear()
      cerrar()
    }
  }
  return (
    <Hoja
      abierta={abierto}
      onCerrar={cerrar}
      titulo="Nuevo modelo JasWave"
      subtitulo="Nace desactivado: configura su cadena y actívalo."
      pie={
        <>
          <Boton variante="fantasma" onClick={cerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" disabled={!valido || repetido || !nombre.trim()} cargando={enviando} onClick={() => void crear()}>
            Crear
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo
          etiqueta="Identificador"
          mono
          value={id}
          placeholder="p. ej. mezcla"
          onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
          ayuda={repetido ? <span className="text-cy-alerta">Ya existe un modelo con ese id.</span> : 'Minúsculas, números y guiones (2–31). No se puede cambiar después.'}
        />
        <Campo etiqueta="Nombre visible" value={nombre} maxLength={60} placeholder="JasWave Mezcla" onChange={(e) => setNombre(e.target.value)} />
        <Campo etiqueta="Descripción" value={descripcion} maxLength={200} placeholder="Para qué sirve, en una frase" onChange={(e) => setDescripcion(e.target.value)} />
      </div>
    </Hoja>
  )
}
