/**
 * IA › Conexiones (antes «proveedores»): endpoints de modelos reales que usan los modelos JasWave.
 * Lista compacta; el detalle va en un panel con el grupo de claves (estado en vivo), los modelos
 * habilitados (con «Descubrir») y los ajustes avanzados plegados. Las claves son de solo escritura.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Cable, ChevronRight, KeyRound, Pause, Play, Plus, Radar, RefreshCw, Trash2 } from 'lucide-react'
import { apiJasWave } from '@/src/lib/backend/sesion'
import type { ClaveConexionIA, DatosProveedorIA, ProveedorIAApi } from '@/src/lib/backend/api'
import { PROVIDER_PRESETS, type AiApiStyle, type AiAuthStyle, type AiProviderCustom, type AiProviderKind } from '@/src/lib/ia/proveedores'
import { cifra, mensaje, useEjecutar, useRecurso } from '../datos'
import type { IdSeccion } from '../navegacion'
import { Boton, BotonIcono, CabeceraSeccion, Campo, Cargando, Casilla, Hoja, Insignia, Interruptor, Led, MensajeError, Panel, Plegable, Selector, TextoEditable, Vacio, type EstadoLed } from '../ui'
import { NavIA } from './ia-nav'

/** Tipos de conexión que puede dar de alta el admin (mismo orden que el formulario de modelos propios). */
const TIPOS_IA: AiProviderKind[] = ['openai-compatible', 'ollama', 'openai', 'anthropic', 'gemini', 'openrouter', 'kilocode']

const etiquetaTipo = (t: string) => PROVIDER_PRESETS[t as AiProviderKind]?.label ?? t
const usaCustom = (t: string) => t === 'openai-compatible' || t === 'kilocode'

type ResumenClaves = { total: number; activas: number; enPausa: number; conError: number }
function resumirClaves(claves: ClaveConexionIA[] | undefined): ResumenClaves | null {
  if (!claves) return null
  const ahora = Date.now()
  return {
    total: claves.length,
    activas: claves.filter((c) => c.activa).length,
    enPausa: claves.filter((c) => c.estado?.enPausaHasta && c.estado.enPausaHasta > ahora).length,
    conError: claves.filter((c) => c.estado?.ultimoError).length,
  }
}

function estadoConexion(p: ProveedorIAApi, r: ResumenClaves | null): { led: EstadoLed; texto: string } {
  if (!p.activo) return { led: 'apagado', texto: 'Inactiva' }
  const necesitaClave = PROVIDER_PRESETS[p.tipo as AiProviderKind]?.needsApiKey ?? true
  if (r && r.activas === 0 && necesitaClave) return { led: 'error', texto: 'Sin claves' }
  if (r && r.enPausa > 0 && r.enPausa >= r.activas) return { led: 'aviso', texto: 'Claves en pausa' }
  return { led: 'ok', texto: 'Operativa' }
}

export function SeccionConexiones({ onIr }: { onIr: (s: IdSeccion) => void }) {
  const { datos, error, cargando, recargar } = useRecurso(async () => {
    const api = apiJasWave().admin.ia
    const [conexiones, deUsuarios] = await Promise.all([api.proveedores(), api.deUsuarios().catch(() => [])])
    const claves = Object.fromEntries(await Promise.all(conexiones.map(async (c) => [c.id, await api.claves(c.id).catch(() => undefined)] as const)))
    return { conexiones, deUsuarios, claves }
  })
  const [abierta, setAbierta] = useState<string | null>(null)
  const [creando, setCreando] = useState(false)
  const conexion = datos?.conexiones.find((c) => c.id === abierta) ?? null

  return (
    <>
      <CabeceraSeccion
        rotulo="Inteligencia artificial"
        titulo="Conexiones"
        descripcion="Endpoints de modelos reales con su grupo de claves. Los modelos JasWave las encadenan."
        acciones={
          <>
            <BotonIcono etiqueta="Recargar" onClick={() => void recargar()}>
              <RefreshCw className={`size-4 ${cargando ? 'animate-spin' : ''}`} />
            </BotonIcono>
            <Boton variante="primario" icono={<Plus className="size-4" />} onClick={() => setCreando(true)}>
              Nueva conexión
            </Boton>
          </>
        }
      />
      <NavIA actual="ia-conexiones" onIr={onIr} />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {!datos && cargando ? <Cargando /> : null}
      {datos ? (
        <div className="flex flex-col gap-4">
          <Panel relleno={false}>
            {datos.conexiones.length === 0 ? (
              <div className="p-4">
                <Vacio icono={<Cable className="size-6" />} titulo="Aún no hay conexiones." />
              </div>
            ) : (
              <ul className="divide-y divide-cy-borde/40">
                {datos.conexiones.map((c) => {
                  const r = resumirClaves(datos.claves[c.id])
                  const e = estadoConexion(c, r)
                  return (
                    <li key={c.id}>
                      <button type="button" onClick={() => setAbierta(c.id)} className="flex min-h-14 w-full min-w-0 items-center gap-3 px-4 py-3 text-left transition hover:bg-cy-cian/[0.04]">
                        <Led estado={e.led} titulo={e.texto} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] text-cy-texto">{c.nombre}</p>
                          <p className="truncate text-[11.5px] text-cy-apagado">
                            {etiquetaTipo(c.tipo)} · <span className={e.led === 'error' ? 'text-cy-alerta' : e.led === 'aviso' ? 'text-cy-ambar' : ''}>{e.texto}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Insignia mono>
                            <KeyRound className="size-3" />
                            {r ? r.total : '—'}
                          </Insignia>
                          <Insignia mono>{c.modelos.length} mod.</Insignia>
                        </div>
                        <ChevronRight className="size-4 shrink-0 text-cy-apagado" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </Panel>

          <Plegable titulo={`Modelos propios de los usuarios · ${datos.deUsuarios.length}`}>
            {datos.deUsuarios.length === 0 ? (
              <p className="text-[12px] text-cy-apagado">Ningún usuario ha añadido modelos propios.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-cy-borde/30">
                {datos.deUsuarios.map((p) => (
                  <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-cy-texto">{p.nombre}</span>
                    <Insignia>{etiquetaTipo(p.tipo)}</Insignia>
                    <Insignia tono={p.ejecucion === 'local' ? 'violeta' : 'neutro'}>{p.ejecucion === 'local' ? 'su equipo' : 'servidor'}</Insignia>
                    <span className="w-full truncate text-[11.5px] text-cy-apagado">
                      {p.propietario ?? '—'} · <span className="font-mono">{p.baseUrl}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Plegable>
        </div>
      ) : null}

      <Hoja abierta={Boolean(conexion)} onCerrar={() => setAbierta(null)} titulo={conexion?.nombre ?? ''} subtitulo={conexion ? `${etiquetaTipo(conexion.tipo)} · ia.proveedor.${conexion.slug}` : undefined}>
        {conexion ? (
          <DetalleConexion
            key={conexion.id}
            conexion={conexion}
            recargar={recargar}
            alEliminar={async () => {
              setAbierta(null)
              await recargar()
            }}
          />
        ) : null}
      </Hoja>
      <NuevaConexion
        abierta={creando}
        onCerrar={() => setCreando(false)}
        alCrear={async (id) => {
          setCreando(false)
          await recargar()
          setAbierta(id)
        }}
      />
    </>
  )
}

// ───────────────────────────── Detalle ─────────────────────────────

function DetalleConexion({ conexion, recargar, alEliminar }: { conexion: ProveedorIAApi; recargar: () => Promise<void>; alEliminar: () => Promise<void> }) {
  const ejecutar = useEjecutar()
  const api = apiJasWave().admin.ia
  const actualizar = async (d: DatosProveedorIA, ok?: string) => {
    if (await ejecutar(() => api.actualizar(conexion.id, d), ok)) {
      await recargar()
      window.dispatchEvent(new CustomEvent('jaswave-ia-catalogo-invalidado'))
      return true
    }
    return false
  }
  const [nombre, setNombre] = useState(conexion.nombre)

  return (
    <div className="flex flex-col gap-6">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <TextoEditable etiqueta="Nombre de la conexión" valor={nombre} onCambiar={setNombre} maxLength={80} className="text-[15px] text-cy-texto" />
        </div>
        {nombre.trim() && nombre !== conexion.nombre ? (
          <Boton variante="primario" compacto onClick={() => void actualizar({ nombre: nombre.trim() }, 'Nombre guardado.')}>
            Guardar
          </Boton>
        ) : null}
        <Interruptor activo={conexion.activo} etiqueta={`Activa ${conexion.nombre}`} textoOn="Activa" textoOff="Inactiva" onCambiar={(v) => void actualizar({ activo: v }, v ? 'Conexión activada.' : 'Conexión desactivada.')} />
      </div>

      <GrupoClaves conexion={conexion} recargarLista={recargar} />
      <ModelosConexion conexion={conexion} actualizar={actualizar} />
      <Plegable titulo="Avanzado">
        <AvanzadoConexion conexion={conexion} actualizar={actualizar} />
      </Plegable>

      <div className="flex justify-end border-t border-cy-borde/40 pt-4">
        <Boton
          variante="peligro"
          icono={<Trash2 className="size-4" />}
          onClick={() => {
            if (window.confirm(`¿Eliminar la conexión «${conexion.nombre}»? Los modelos JasWave que la usen perderán esos eslabones.`))
              void ejecutar(() => api.eliminar(conexion.id), 'Conexión eliminada.').then((ok) => { if (ok) void alEliminar() })
          }}
        >
          Eliminar conexión
        </Boton>
      </div>
    </div>
  )
}

function estadoClave(c: ClaveConexionIA, ahora: number): { led: EstadoLed; texto: string } {
  if (!c.activa) return { led: 'apagado', texto: 'Pausada' }
  if (c.estado?.enPausaHasta && c.estado.enPausaHasta > ahora) return { led: 'aviso', texto: `Enfriando ${Math.ceil((c.estado.enPausaHasta - ahora) / 1000)} s` }
  if (c.estado && c.estado.enVuelo > 0) return { led: 'activo', texto: `${c.estado.enVuelo} en vuelo` }
  if (c.estado?.ultimoError) return { led: 'error', texto: 'Último intento falló' }
  return { led: 'ok', texto: c.estado ? 'Lista' : 'Sin uso aún' }
}

function GrupoClaves({ conexion, recargarLista }: { conexion: ProveedorIAApi; recargarLista: () => Promise<void> }) {
  const ejecutar = useEjecutar()
  const api = apiJasWave().admin.ia
  const [claves, setClaves] = useState<ClaveConexionIA[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nueva, setNueva] = useState('')
  const [etiqueta, setEtiqueta] = useState('')
  const [ahora, setAhora] = useState(() => Date.now())

  const cargar = useCallback(async () => {
    try {
      setClaves(await apiJasWave().admin.ia.claves(conexion.id))
      setError(null)
    } catch (e) {
      setError(mensaje(e))
    }
    setAhora(Date.now())
  }, [conexion.id])

  // Estado en vivo: se refresca cada 4 s mientras el panel está abierto y visible.
  useEffect(() => {
    void cargar()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void cargar()
    }, 4000)
    return () => clearInterval(t)
  }, [cargar])

  const tras = async (ok: boolean) => {
    if (!ok) return
    await cargar()
    await recargarLista()
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="cy-rotulo">Grupo de claves</h3>
        <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-cy-apagado">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-cy-cian/60" />
            <span className="relative inline-flex size-2 rounded-full bg-cy-cian" />
          </span>
          en vivo
        </span>
      </div>
      {error ? <MensajeError>{error}</MensajeError> : null}
      {claves === null && !error ? <Cargando /> : null}
      {claves?.length === 0 ? <p className="rounded-lg border border-dashed border-cy-borde/70 px-3 py-3 text-[12px] text-cy-apagado">Sin claves. Añade una o varias: se reparten las peticiones y si una falla se usa la siguiente.</p> : null}
      <ul className="flex flex-col gap-2">
        {claves?.map((c) => {
          const e = estadoClave(c, ahora)
          return (
            <li key={c.id} className="rounded-xl border border-cy-borde/60 bg-cy-negro/50 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-3">
                <Led estado={e.led} titulo={e.texto} />
                <div className="min-w-0 flex-1">
                  <p className="flex min-w-0 items-center gap-2 text-[13px] text-cy-texto">
                    <span className="truncate">{c.etiqueta || 'Sin etiqueta'}</span>
                    {c.principal && c.etiqueta !== 'Principal' ? <Insignia tono="cian">principal</Insignia> : null}
                  </p>
                  <p className="truncate text-[11px] text-cy-apagado">
                    {e.texto} · <span className="font-mono tabular-nums">{cifra(c.estado?.usos ?? 0)}</span> usos · <span className={`font-mono tabular-nums ${c.estado?.fallos ? 'text-cy-alerta' : ''}`}>{cifra(c.estado?.fallos ?? 0)}</span> fallos
                  </p>
                </div>
                {!c.principal ? (
                  <BotonIcono etiqueta={c.activa ? 'Pausar clave' : 'Reanudar clave'} onClick={() => void ejecutar(() => api.cambiarClave(conexion.id, c.id, { activa: !c.activa }), c.activa ? 'Clave pausada.' : 'Clave reanudada.').then(tras)}>
                    {c.activa ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </BotonIcono>
                ) : null}
                <BotonIcono
                  etiqueta="Quitar clave"
                  peligro
                  onClick={() => {
                    if (!window.confirm(`¿Quitar la clave «${c.etiqueta || 'sin etiqueta'}»?`)) return
                    // La principal vive en la conexión (no en el grupo): se borra con PUT /clave null.
                    void ejecutar(() => (c.principal ? api.clave(conexion.id, null) : api.quitarClave(conexion.id, c.id)), 'Clave quitada.').then(tras)
                  }}
                >
                  <Trash2 className="size-4" />
                </BotonIcono>
              </div>
              {c.estado?.ultimoError ? <p className="mt-1 truncate pl-5 text-[11px] text-cy-alerta" title={c.estado.ultimoError}>{c.estado.ultimoError}</p> : null}
            </li>
          )
        })}
      </ul>
      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px_auto]"
        onSubmit={(e) => {
          e.preventDefault()
          void ejecutar(() => api.agregarClave(conexion.id, nueva.trim(), etiqueta.trim()), 'Clave añadida.').then((ok) => {
            if (ok) {
              setNueva('')
              setEtiqueta('')
            }
            return tras(ok)
          })
        }}
      >
        <input type="password" autoComplete="off" value={nueva} onChange={(e) => setNueva(e.target.value)} placeholder="Nueva API key" aria-label="Nueva API key" className="cy-entrada min-h-11 font-mono md:min-h-9" />
        <input value={etiqueta} maxLength={60} onChange={(e) => setEtiqueta(e.target.value)} placeholder="Etiqueta" aria-label="Etiqueta de la clave" className="cy-entrada min-h-11 md:min-h-9" />
        <Boton type="submit" variante="primario" disabled={!nueva.trim()} icono={<Plus className="size-4" />}>
          Añadir
        </Boton>
      </form>
      <p className="text-[11px] text-cy-apagado">Las claves se guardan cifradas y no se vuelven a mostrar.</p>
    </section>
  )
}

function ModelosConexion({ conexion, actualizar }: { conexion: ProveedorIAApi; actualizar: (d: DatosProveedorIA, ok?: string) => Promise<boolean> }) {
  const [habilitados, setHabilitados] = useState<string[]>(conexion.modelos)
  const [descubiertos, setDescubiertos] = useState<string[]>([])
  const [porDefecto, setPorDefecto] = useState(conexion.modeloPorDefecto)
  const [manual, setManual] = useState('')
  const [buscando, setBuscando] = useState(false)
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null)
  const [filtro, setFiltro] = useState('')

  const todos = useMemo(() => [...new Set([...conexion.modelos, ...habilitados, ...descubiertos])], [conexion.modelos, habilitados, descubiertos])
  const visibles = filtro ? todos.filter((m) => m.toLowerCase().includes(filtro.toLowerCase())) : todos
  const sucio = JSON.stringify(habilitados) !== JSON.stringify(conexion.modelos) || porDefecto !== conexion.modeloPorDefecto

  const descubrir = async () => {
    setBuscando(true)
    setResultado(null)
    try {
      const r = await apiJasWave().admin.ia.probar(conexion.id)
      setDescubiertos(r.modelos)
      setResultado(
        r.estado === 'healthy'
          ? { ok: true, texto: `Conectado · ${r.modelos.length} modelos disponibles` }
          : { ok: false, texto: `${r.estado}${r.error ? `: ${r.error}` : ''}${r.pista ? ` (${r.pista})` : ''}` },
      )
    } catch (e) {
      setResultado({ ok: false, texto: mensaje(e) })
    }
    setBuscando(false)
  }

  const alternar = (m: string, v: boolean) => setHabilitados((h) => (v ? [...h, m] : h.filter((x) => x !== m)))

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="cy-rotulo">Modelos · {habilitados.length} habilitados</h3>
        <Boton compacto icono={<Radar className="size-4" />} cargando={buscando} onClick={() => void descubrir()}>
          Descubrir
        </Boton>
      </div>
      {resultado ? (
        <p className={`flex items-center gap-2 text-[12px] ${resultado.ok ? 'text-cy-ok' : 'text-cy-alerta'}`}>
          <Led estado={resultado.ok ? 'ok' : 'error'} />
          <span className="min-w-0 break-words">{resultado.texto}</span>
        </p>
      ) : null}
      {todos.length > 8 ? <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Filtrar modelos…" aria-label="Filtrar modelos" className="cy-entrada min-h-11 md:min-h-9" /> : null}
      <div className="max-h-72 overflow-y-auto rounded-xl border border-cy-borde/60 bg-cy-negro/40 px-3 py-1">
        {visibles.length === 0 ? <p className="py-3 text-[12px] text-cy-apagado">Sin modelos. Pulsa «Descubrir» o añade uno a mano.</p> : null}
        {visibles.map((m) => (
          <div key={m} className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <Casilla mono etiqueta={m} checked={habilitados.includes(m)} onChange={(v) => alternar(m, v)} />
            </div>
            {descubiertos.length && !descubiertos.includes(m) ? <Insignia tono="aviso">no listado</Insignia> : null}
            {!conexion.modelos.includes(m) && descubiertos.includes(m) ? <Insignia tono="cian">nuevo</Insignia> : null}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Añadir modelo a mano" aria-label="Añadir modelo a mano" className="cy-entrada min-h-11 font-mono text-[12px] md:min-h-9" />
        <Boton
          compacto
          disabled={!manual.trim()}
          onClick={() => {
            const m = manual.trim()
            if (!habilitados.includes(m)) setHabilitados((h) => [...h, m])
            setManual('')
          }}
        >
          <Plus className="size-4" />
        </Boton>
      </div>
      <Selector etiqueta="Modelo por defecto" value={habilitados.includes(porDefecto) ? porDefecto : ''} onChange={(e) => setPorDefecto(e.target.value)}>
        <option value="">El primero habilitado</option>
        {habilitados.map((m) => (
          <option key={m} value={m}>
            {m}
          </option>
        ))}
      </Selector>
      {sucio ? (
        <div className="flex justify-end gap-2">
          <Boton
            variante="fantasma"
            onClick={() => {
              setHabilitados(conexion.modelos)
              setPorDefecto(conexion.modeloPorDefecto)
            }}
          >
            Descartar
          </Boton>
          <Boton
            variante="primario"
            disabled={habilitados.length === 0}
            onClick={() =>
              void actualizar(
                { modelos: habilitados, ...(habilitados.includes(porDefecto) ? { modeloPorDefecto: porDefecto } : { modeloPorDefecto: habilitados[0] }) },
                'Modelos guardados.',
              )
            }
          >
            Guardar modelos
          </Boton>
        </div>
      ) : null}
    </section>
  )
}

function AvanzadoConexion({ conexion, actualizar }: { conexion: ProveedorIAApi; actualizar: (d: DatosProveedorIA, ok?: string) => Promise<boolean> }) {
  const inicial = useMemo(
    () => ({
      baseUrl: conexion.baseUrl ?? '',
      herramientas: conexion.herramientas == null ? 'auto' : conexion.herramientas ? 'si' : 'no',
      porMinuto: String(conexion.peticionesPorMinuto ?? 30),
      maxTokens: String(conexion.maxTokens),
      custom: (conexion.custom as AiProviderCustom | null) ?? {},
      cabeceras: JSON.stringify((conexion.custom as AiProviderCustom | null)?.extraHeaders ?? {}),
    }),
    [conexion],
  )
  const [v, setV] = useState(inicial)
  const [error, setError] = useState<string | null>(null)
  const cambiar = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }))
  const cambiarCustom = (p: Partial<AiProviderCustom>) => setV((x) => ({ ...x, custom: { ...x.custom, ...p } }))
  const sucio = JSON.stringify(v) !== JSON.stringify(inicial)

  const guardar = async () => {
    let extraHeaders: Record<string, string> | undefined
    try {
      const h = JSON.parse(v.cabeceras || '{}') as unknown
      if (!h || typeof h !== 'object' || Array.isArray(h)) throw new Error()
      extraHeaders = Object.keys(h).length ? (h as Record<string, string>) : undefined
    } catch {
      setError('Las cabeceras deben ser un objeto JSON, p. ej. {"HTTP-Referer": "https://…"}')
      return
    }
    setError(null)
    const custom = { ...v.custom, extraHeaders }
    if (!extraHeaders) delete custom.extraHeaders
    await actualizar(
      {
        baseUrl: v.baseUrl.trim(),
        herramientas: v.herramientas === 'auto' ? null : v.herramientas === 'si',
        ...(Number(v.porMinuto) > 0 ? { peticionesPorMinuto: Math.round(Number(v.porMinuto)) } : {}),
        ...(Number(v.maxTokens) > 0 ? { maxTokens: Math.round(Number(v.maxTokens)) } : {}),
        ...(usaCustom(conexion.tipo) ? { custom } : {}),
      },
      'Ajustes guardados.',
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <Campo etiqueta="URL base" mono value={v.baseUrl} onChange={(e) => cambiar({ baseUrl: e.target.value })} ayuda={PROVIDER_PRESETS[conexion.tipo as AiProviderKind]?.hint} />
      <Campo etiqueta="Identificador (slug)" mono value={conexion.slug} readOnly disabled ayuda={`Permiso: ia.proveedor.${conexion.slug} · no se puede cambiar.`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Selector etiqueta="Herramientas" value={v.herramientas} onChange={(e) => cambiar({ herramientas: e.target.value })}>
          <option value="auto">Automático</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </Selector>
        <Campo etiqueta="Pet. / min y usuario" type="number" min={1} mono value={v.porMinuto} onChange={(e) => cambiar({ porMinuto: e.target.value })} />
        <Campo etiqueta="Máx. tokens" type="number" min={1} max={64000} mono value={v.maxTokens} onChange={(e) => cambiar({ maxTokens: e.target.value })} />
      </div>
      {usaCustom(conexion.tipo) ? (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Selector etiqueta="Estilo de API" value={v.custom.apiStyle ?? 'openai'} onChange={(e) => cambiarCustom({ apiStyle: e.target.value as AiApiStyle })}>
              <option value="openai">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
              <option value="ollama">Ollama</option>
            </Selector>
            <Selector etiqueta="Autenticación" value={v.custom.authStyle ?? 'bearer'} onChange={(e) => cambiarCustom({ authStyle: e.target.value as AiAuthStyle })}>
              <option value="bearer">Bearer</option>
              <option value="x-api-key">x-api-key</option>
              <option value="none">Ninguna</option>
            </Selector>
            <Campo etiqueta="Ruta de chat" mono value={v.custom.chatPath ?? '/chat/completions'} onChange={(e) => cambiarCustom({ chatPath: e.target.value })} />
            <Campo etiqueta="Ruta de modelos" mono value={v.custom.modelsPath ?? '/models'} onChange={(e) => cambiarCustom({ modelsPath: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2">
            <Casilla etiqueta="Añadir /v1 si falta" checked={v.custom.appendV1 === true} onChange={(x) => cambiarCustom({ appendV1: x })} />
            <Casilla etiqueta="Requiere API key" checked={v.custom.needsApiKey !== false} onChange={(x) => cambiarCustom({ needsApiKey: x })} />
          </div>
        </>
      ) : null}
      <Campo etiqueta="Cabeceras extra (JSON)" mono value={v.cabeceras} onChange={(e) => cambiar({ cabeceras: e.target.value })} disabled={!usaCustom(conexion.tipo)} ayuda={usaCustom(conexion.tipo) ? undefined : 'Solo para conexiones compatibles con OpenAI o Kilo Code.'} />
      {error ? <MensajeError>{error}</MensajeError> : null}
      {sucio ? (
        <div className="flex justify-end gap-2">
          <Boton variante="fantasma" onClick={() => setV(inicial)}>
            Descartar
          </Boton>
          <Boton variante="primario" disabled={!v.baseUrl.trim()} onClick={() => void guardar()}>
            Guardar ajustes
          </Boton>
        </div>
      ) : null}
    </div>
  )
}

// ───────────────────────────── Alta ─────────────────────────────

function NuevaConexion({ abierta, onCerrar, alCrear }: { abierta: boolean; onCerrar: () => void; alCrear: (id: string) => Promise<void> }) {
  const ejecutar = useEjecutar()
  const [tipo, setTipo] = useState<AiProviderKind>('openai-compatible')
  const [nombre, setNombre] = useState('')
  const [slug, setSlug] = useState('')
  const [slugTocado, setSlugTocado] = useState(false)
  const [baseUrl, setBaseUrl] = useState(PROVIDER_PRESETS['openai-compatible'].defaultBaseUrl)
  const [apiKey, setApiKey] = useState('')
  const [enviando, setEnviando] = useState(false)
  const preset = PROVIDER_PRESETS[tipo]
  const slugAuto = nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  const slugFinal = slugTocado ? slug : slugAuto
  const valido = nombre.trim() && /^[a-z0-9][a-z0-9-]{1,40}$/.test(slugFinal) && /^https?:\/\//.test(baseUrl.trim())

  const cerrar = () => {
    setNombre('')
    setSlug('')
    setSlugTocado(false)
    setApiKey('')
    onCerrar()
  }
  const crear = async () => {
    setEnviando(true)
    let id = ''
    const ok = await ejecutar(async () => {
      const p = await apiJasWave().admin.ia.crear({
        slug: slugFinal,
        nombre: nombre.trim(),
        tipo,
        baseUrl: baseUrl.trim(),
        modelos: [preset.defaultModel || 'modelo'],
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      })
      id = p.id
    }, 'Conexión creada. Descubre sus modelos y añade más claves si quieres.')
    setEnviando(false)
    setApiKey('')
    if (ok) {
      setNombre('')
      setSlug('')
      setSlugTocado(false)
      await alCrear(id)
    }
  }

  return (
    <Hoja
      abierta={abierta}
      onCerrar={cerrar}
      titulo="Nueva conexión"
      subtitulo="Después podrás descubrir sus modelos y añadir más claves."
      pie={
        <>
          <Boton variante="fantasma" onClick={cerrar}>
            Cancelar
          </Boton>
          <Boton variante="primario" disabled={!valido} cargando={enviando} onClick={() => void crear()}>
            Crear conexión
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div>
          <p className="mb-2 text-[10.5px] uppercase tracking-[0.16em] text-cy-apagado">Tipo</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TIPOS_IA.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={t === tipo}
                onClick={() => {
                  setTipo(t)
                  setBaseUrl(PROVIDER_PRESETS[t].defaultBaseUrl)
                }}
                className={`min-h-11 rounded-lg border px-2 text-[12px] transition ${t === tipo ? 'border-cy-cian/60 bg-cy-cian/10 text-cy-cian shadow-[0_0_12px_-4px_rgba(25,217,255,0.6)]' : 'border-cy-borde bg-cy-negro text-cy-tenue hover:text-cy-texto'}`}
              >
                {PROVIDER_PRESETS[t].label}
              </button>
            ))}
          </div>
        </div>
        <Campo etiqueta="Nombre" value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="p. ej. OpenRouter producción" />
        <Campo
          etiqueta="Identificador (slug)"
          mono
          value={slugFinal}
          onChange={(e) => {
            setSlugTocado(true)
            setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
          }}
          ayuda={`Permiso ia.proveedor.${slugFinal || '…'} · no se puede cambiar después.`}
        />
        <Campo etiqueta="URL base" mono value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} ayuda={preset.hint} />
        <Campo etiqueta="API key (opcional)" type="password" autoComplete="off" mono value={apiKey} onChange={(e) => setApiKey(e.target.value)} ayuda="Será la clave principal; se guarda cifrada y no se vuelve a mostrar." />
      </div>
    </Hoja>
  )
}
