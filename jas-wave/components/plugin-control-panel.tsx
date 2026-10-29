/**
 * Controles de un plugin de la cadena (paridad con la IA): parámetros en vivo con búsqueda y reset,
 * biblioteca de presets y herramientas (guardar estado, probar carga, guía de uso).
 * Cada botón ejecuta la misma acción que puede usar la IA (`accionPluginUsuario`), con deshacer y auditoría.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Globe, Headphones, Play, RefreshCw, RotateCcw, Save, Search, Stethoscope } from 'lucide-react'
import { useDAW } from '@/src/context/daw-context'
import type { PluginInfo } from '../../shared/src/types/entidades'
import { searchParameters, type SemanticParameter } from '@/src/lib/plugin/plugin-parameter-intel'
import { accionPluginUsuario } from '@/src/lib/plugin/plugin-ui-acciones'
import { crearVentanaGesto, nuevoGestureId, opcionesGesto } from '@/src/lib/gesture-id'
import { extractHostPluginPath } from '@/src/lib/plugin/plugin-info-adapter'
import type { LibraryPreset } from '@/src/lib/library/preset-catalog'

type Pestana = 'parametros' | 'presets' | 'herramientas'

type Bundle = { pluginInstanceId: string; parameters: SemanticParameter[] }

const EPS = 1e-6

function enDefecto(p: SemanticParameter): boolean {
  const d = Number(p.defaultNormalizedValue)
  return !Number.isFinite(d) || Math.abs(d - p.normalizedValue) < EPS
}

export function PluginControlPanel({ trackId, plugin }: { trackId: string; plugin: PluginInfo }) {
  const tienda = useDAW()
  const [pestana, setPestana] = useState<Pestana>('parametros')
  const [msg, setMsg] = useState('')
  const [ocupado, setOcupado] = useState(false)

  const ejecutar = useCallback(
    async (type: string, payload: Record<string, unknown>) => {
      setOcupado(true)
      try {
        const r = await accionPluginUsuario(tienda, type, payload)
        setMsg(r.message)
        return r
      } finally {
        setOcupado(false)
      }
    },
    [tienda],
  )

  return (
    <div className="mt-1 rounded-md border border-border bg-background/60 p-2" data-testid="plugin-control-panel">
      <div className="mb-2 flex gap-1" role="tablist" aria-label={`Controles de ${plugin.nombre}`}>
        {(
          [
            ['parametros', 'Parámetros'],
            ['presets', 'Presets'],
            ['herramientas', 'Herramientas'],
          ] as const
        ).map(([id, titulo]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={pestana === id}
            onClick={() => setPestana(id)}
            className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
              pestana === id ? 'bg-accent-amber/15 text-accent-amber' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {titulo}
          </button>
        ))}
      </div>
      {pestana === 'parametros' ? (
        <PestanaParametros trackId={trackId} plugin={plugin} ejecutar={ejecutar} ocupado={ocupado} setMsg={setMsg} />
      ) : pestana === 'presets' ? (
        <PestanaPresets trackId={trackId} plugin={plugin} ejecutar={ejecutar} ocupado={ocupado} />
      ) : (
        <PestanaHerramientas trackId={trackId} plugin={plugin} ejecutar={ejecutar} ocupado={ocupado} />
      )}
      {msg ? (
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-[10px] leading-snug text-muted-foreground" role="status">
          {msg}
        </p>
      ) : null}
    </div>
  )
}

type Ejecutar = (type: string, payload: Record<string, unknown>) => Promise<{ success: boolean; message: string; data?: unknown }>

function PestanaParametros({
  trackId,
  plugin,
  ejecutar,
  ocupado,
  setMsg,
}: {
  trackId: string
  plugin: PluginInfo
  ejecutar: Ejecutar
  ocupado: boolean
  setMsg: (m: string) => void
}) {
  const tienda = useDAW()
  const [params, setParams] = useState<SemanticParameter[]>([])
  const [cargando, setCargando] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [ocultos, setOcultos] = useState(false)
  const gestoRueda = useMemo(() => crearVentanaGesto(600), [])
  const gestoArrastre = useRef<string | undefined>(undefined)
  const esVst = Boolean(extractHostPluginPath(plugin.descripcion ?? '', plugin.id))

  const cargar = useCallback(async () => {
    setCargando(true)
    try {
      const r = await accionPluginUsuario(tienda, 'plugin.listParameters', { trackId, pluginInstanceId: plugin.id })
      const bundles = (Array.isArray(r.data) ? r.data : []) as Bundle[]
      setParams(bundles.find((b) => b.pluginInstanceId === plugin.id)?.parameters ?? [])
      if (!r.success) setMsg(r.message)
    } finally {
      setCargando(false)
    }
  }, [tienda, trackId, plugin.id, setMsg])

  useEffect(() => {
    if (esVst) void cargar()
  }, [cargar, esVst])

  const visibles = useMemo(
    () => searchParameters(params, consulta, { includeHidden: ocultos, limit: 400 }).filter((p) => !p.readOnly),
    [params, consulta, ocultos],
  )

  const fijar = (p: SemanticParameter, valor: number, gestureId?: string) => {
    const v = Math.min(1, Math.max(0, valor))
    setParams((prev) => prev.map((x) => (x.parameterId === p.parameterId ? { ...x, normalizedValue: v, displayValue: '' } : x)))
    // El host recibe el valor por el evento plugin.parametro.cambiado (sincronizarParametrosConHost)
    void tienda.executor.execute(
      'plugin.setParameter',
      { trackId, pluginInstanceId: plugin.id, parameterId: p.parameterId, normalizedValue: v, name: p.name },
      'user',
      undefined,
      opcionesGesto(`plugin.param:${plugin.id}:${p.parameterId}`, gestureId),
    )
  }

  const restablecer = async (ids?: string[]) => {
    const r = await ejecutar('plugin.resetDefaults', { trackId, pluginInstanceId: plugin.id, ...(ids ? { parameterIds: ids } : {}) })
    if (r.success) void cargar()
  }

  if (!esVst) {
    return (
      <p className="text-[10px] text-muted-foreground">
        «{plugin.nombre}» es un procesador integrado: sus controles están en el panel de la pista.
      </p>
    )
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-1">
        <label className="flex min-w-0 flex-1 items-center gap-1 rounded border border-border bg-background px-1.5">
          <Search className="size-3 shrink-0 text-muted-foreground" />
          <input
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar parámetro (cutoff, attack, mix…)"
            aria-label="Buscar parámetro"
            className="min-w-0 flex-1 bg-transparent py-1 text-[10px] outline-none"
          />
        </label>
        <button
          type="button"
          title="Releer parámetros del plugin"
          disabled={cargando}
          onClick={() => void cargar()}
          className="rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          <RefreshCw className={`size-3 ${cargando ? 'animate-spin' : ''}`} />
        </button>
        <button
          type="button"
          disabled={ocupado || cargando}
          title="Todos los parámetros a su valor por defecto (un paso de deshacer)"
          onClick={() => void restablecer()}
          className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:opacity-40"
        >
          <RotateCcw className="size-3" />
          Restablecer todo
        </button>
      </div>
      <label className="mb-1 flex items-center gap-1 text-[9px] text-muted-foreground">
        <input type="checkbox" checked={ocultos} onChange={(e) => setOcultos(e.target.checked)} />
        Mostrar parámetros ocultos
      </label>
      {cargando && !params.length ? (
        <p className="text-[10px] text-muted-foreground">Leyendo parámetros…</p>
      ) : !visibles.length ? (
        <p className="text-[10px] text-muted-foreground">
          {params.length ? `Ningún parámetro coincide con «${consulta}».` : 'El plugin no expone parámetros (¿está cargado en el motor?).'}
        </p>
      ) : (
        <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
          {visibles.map((p) => {
            const def = Number(p.defaultNormalizedValue)
            const movido = !enDefecto(p)
            return (
              <li key={p.parameterId} className="grid grid-cols-[minmax(0,7rem)_1fr_auto_auto] items-center gap-1.5">
                <span
                  className="truncate text-[10px] text-foreground"
                  title={`${p.name} · id ${p.parameterId}${p.semanticTags.length ? ` · ${p.semanticTags.join(', ')}` : ''}`}
                >
                  {p.name}
                </span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={p.stepCount && p.stepCount > 0 ? 1 / p.stepCount : 0.001}
                  value={p.normalizedValue}
                  aria-label={p.name}
                  title="Doble clic o clic central: valor por defecto"
                  className="h-1 w-full accent-accent-amber"
                  onPointerDown={(e) => {
                    if (e.button === 1) {
                      e.preventDefault()
                      if (movido && Number.isFinite(def)) fijar(p, def)
                      return
                    }
                    gestoArrastre.current = nuevoGestureId('param')
                  }}
                  onPointerUp={() => {
                    gestoArrastre.current = undefined
                  }}
                  onAuxClick={(e) => {
                    if (e.button === 1) e.preventDefault()
                  }}
                  onDoubleClick={() => {
                    if (movido && Number.isFinite(def)) fijar(p, def)
                  }}
                  onWheel={(e) => {
                    const paso = p.stepCount && p.stepCount > 0 ? 1 / p.stepCount : e.shiftKey ? 0.001 : 0.01
                    fijar(p, p.normalizedValue + (e.deltaY < 0 ? paso : -paso), gestoRueda())
                  }}
                  onChange={(e) => fijar(p, Number(e.target.value), gestoArrastre.current ?? gestoRueda())}
                />
                <span className="w-14 truncate text-right font-mono text-[9px] tabular-nums text-muted-foreground">
                  {p.displayValue || p.normalizedValue.toFixed(3)}
                  {p.unit && p.displayValue ? ` ${p.unit}` : ''}
                </span>
                <button
                  type="button"
                  disabled={!movido || ocupado}
                  title="Valor por defecto"
                  onClick={() => void restablecer([p.parameterId])}
                  className="rounded p-0.5 text-muted-foreground hover:text-accent-amber disabled:opacity-25"
                >
                  <RotateCcw className="size-3" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function PestanaPresets({
  trackId,
  plugin,
  ejecutar,
  ocupado,
}: {
  trackId: string
  plugin: PluginInfo
  ejecutar: Ejecutar
  ocupado: boolean
}) {
  const [presets, setPresets] = useState<LibraryPreset[]>([])
  const [consulta, setConsulta] = useState('')
  const [soloEste, setSoloEste] = useState(true)
  const [nombre, setNombre] = useState(`${plugin.nombre} · mío`)
  const [genero, setGenero] = useState('')

  const cargar = useCallback(async () => {
    const r = await ejecutar('library.preset.search', { query: consulta || undefined, scope: 'all' })
    const lista = ((r.data as { presets?: LibraryPreset[] } | undefined)?.presets ?? []).filter(
      (p) => (p.type ?? 'plugin') === 'plugin',
    )
    setPresets(lista)
  }, [ejecutar, consulta])

  useEffect(() => {
    void cargar()
    // solo al abrir; buscar se pide con el botón o Enter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const ruta = extractHostPluginPath(plugin.descripcion ?? '', plugin.id)
  const visibles = soloEste
    ? presets.filter((p) => p.pluginNombre === plugin.nombre || (ruta && p.pluginPath === ruta))
    : presets

  const guardar = async (global: boolean) => {
    if (!nombre.trim()) return
    await ejecutar(global ? 'library.preset.saveGlobal' : 'library.preset.save', {
      trackId,
      pluginInstanceId: plugin.id,
      nombre: nombre.trim(),
      ...(genero.trim() ? { genero: genero.trim() } : {}),
    })
    void cargar()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <input
          value={consulta}
          onChange={(e) => setConsulta(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void cargar()
          }}
          placeholder="Buscar presets (nombre, rol, género)"
          aria-label="Buscar presets"
          className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 text-[10px]"
        />
        <button
          type="button"
          disabled={ocupado}
          onClick={() => void cargar()}
          className="rounded border border-border px-1.5 py-0.5 text-[10px] hover:bg-muted disabled:opacity-40"
        >
          Buscar
        </button>
      </div>
      <label className="flex items-center gap-1 text-[9px] text-muted-foreground">
        <input type="checkbox" checked={soloEste} onChange={(e) => setSoloEste(e.target.checked)} />
        Solo presets de «{plugin.nombre}»
      </label>
      {visibles.length ? (
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
          {visibles.map((p) => (
            <li key={p.id} className="flex items-center gap-1 rounded border border-border/60 px-1.5 py-1">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[10px] font-semibold text-foreground">{p.nombre}</div>
                <div className="truncate text-[9px] text-muted-foreground">
                  {p.pluginNombre}
                  {p.rol ? ` · ${p.rol}` : ''}
                  {p.generoTags?.length ? ` · ${p.generoTags.join(', ')}` : ''} · {p.scope === 'global' ? 'global' : 'proyecto'}
                </div>
              </div>
              <button
                type="button"
                disabled={ocupado}
                title="Cargar este preset en la pista"
                onClick={() => void ejecutar('library.preset.apply', { presetId: p.id, trackId })}
                className="rounded p-0.5 text-muted-foreground hover:text-accent-amber"
              >
                <Play className="size-3" />
              </button>
              <button
                type="button"
                disabled={ocupado}
                title="Escuchar: crea una pista de audición con un patrón corto"
                onClick={() => void ejecutar('library.preset.audition', { presetId: p.id, bars: 2 })}
                className="rounded p-0.5 text-muted-foreground hover:text-accent-amber"
              >
                <Headphones className="size-3" />
              </button>
              {p.scope !== 'global' ? (
                <button
                  type="button"
                  disabled={ocupado}
                  title="Hacer global (disponible en todos tus proyectos)"
                  onClick={async () => {
                    await ejecutar('library.preset.promote', { presetId: p.id })
                    void cargar()
                  }}
                  className="rounded p-0.5 text-muted-foreground hover:text-accent-amber"
                >
                  <Globe className="size-3" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[10px] text-muted-foreground">Sin presets{soloEste ? ' de este plugin' : ''}. Guarda el sonido actual abajo.</p>
      )}
      <div className="space-y-1 border-t border-border/60 pt-2">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">Guardar el sonido actual</div>
        <input
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          aria-label="Nombre del preset"
          className="w-full rounded border border-border bg-background px-1.5 py-1 text-[10px]"
        />
        <input
          value={genero}
          onChange={(e) => setGenero(e.target.value)}
          placeholder="Género (opcional): worship, pop…"
          aria-label="Género del preset"
          className="w-full rounded border border-border bg-background px-1.5 py-1 text-[10px]"
        />
        <div className="flex gap-1">
          <button
            type="button"
            disabled={ocupado || !nombre.trim()}
            onClick={() => void guardar(false)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-border px-1.5 py-1 text-[10px] hover:bg-muted disabled:opacity-40"
          >
            <Save className="size-3" />
            En el proyecto
          </button>
          <button
            type="button"
            disabled={ocupado || !nombre.trim()}
            onClick={() => void guardar(true)}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded bg-accent-amber/15 px-1.5 py-1 text-[10px] font-semibold text-accent-amber hover:bg-accent-amber/25 disabled:opacity-40"
          >
            <Globe className="size-3" />
            Global
          </button>
        </div>
      </div>
    </div>
  )
}

function PestanaHerramientas({
  trackId,
  plugin,
  ejecutar,
  ocupado,
}: {
  trackId: string
  plugin: PluginInfo
  ejecutar: Ejecutar
  ocupado: boolean
}) {
  const ruta = extractHostPluginPath(plugin.descripcion ?? '', plugin.id)
  const boton = 'inline-flex w-full items-center gap-1.5 rounded border border-border px-2 py-1 text-left text-[10px] hover:bg-muted disabled:opacity-40'
  return (
    <div className="space-y-1">
      <button
        type="button"
        disabled={ocupado || !ruta}
        className={boton}
        title="Copia el estado completo del VST (chunk y parámetros) al proyecto para que se guarde con él"
        onClick={() => void ejecutar('plugin.snapshotState', { trackId, pluginId: plugin.id })}
      >
        <Save className="size-3" />
        Guardar estado en el proyecto
      </button>
      <button
        type="button"
        disabled={ocupado || !ruta}
        className={boton}
        title="Carga el plugin en el motor en un slot de prueba y comprueba que responde"
        onClick={() => void ejecutar('plugin.probe', { nombre: plugin.nombre, ...(ruta ? { path: ruta } : {}) })}
      >
        <Stethoscope className="size-3" />
        Probar carga en el motor
      </button>
      <button
        type="button"
        disabled={ocupado}
        className={boton}
        title="Guía de uso del plugin (catálogo y web)"
        onClick={() => void ejecutar('plugin.lookup', { nombre: plugin.nombre })}
      >
        <BookOpen className="size-3" />
        Guía de uso
      </button>
    </div>
  )
}
