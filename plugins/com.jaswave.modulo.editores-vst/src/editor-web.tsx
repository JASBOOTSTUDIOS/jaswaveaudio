/**
 * Editor de un VST de JasWave en la web: el mismo diseño que el editor nativo (V3), dibujado en Canvas por
 * @jaswave/ui-cyber desde su ui-layout.json. Los parámetros viven en el proyecto: cada gesto es un
 * `plugin.setParameter` (un paso de deshacer, auditado) y emite `plugin.parametro.cambiado`.
 *
 * En la web el DSP de los VST no corre: el espectro muestra la salida de la pista y la medición en vivo
 * (GR, LUFS…) la calcula el VST al abrir el proyecto en escritorio. El panel lo dice.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  EditorCyber,
  PESTANAS,
  aNormalizado,
  aPlano,
  columnasDesdeBins,
  defDe,
  interpretar,
  modoPorAncho,
  normalizadoPorDefecto,
  vistaDe,
  type FaseCambio,
  type Modo,
  type Pestana,
  type RectCss,
  type WidgetLayout,
} from '@jaswave/ui-cyber'
import { espectroDePista, useDAW, useDAWState, type DAWState } from '@jaswave/host-sdk'
import { ISOTIPO } from './generado/isotipo'
import { layoutPorNombre } from './layouts'

/** Cadena de efectos del master (mismos ids que MASTER_FX_TRACK_ID en el núcleo). */
const esMaster = (trackId: string) => trackId === 'master' || trackId === '__master__'

type Props = { trackId: string; pluginInstanceId: string }
type PluginEnProyecto = { id: string; nombre: string; parametros?: Array<{ id: string; valor: number }> }

function pluginDe(s: DAWState, trackId: string, pluginInstanceId: string): PluginEnProyecto | null {
  const p = s.project as unknown as { tracks?: Array<{ id: string; plugins?: PluginEnProyecto[] }>; master?: { plugins?: PluginEnProyecto[] } }
  const cadena = esMaster(trackId) ? p.master?.plugins : p.tracks?.find((t) => t.id === trackId)?.plugins
  return cadena?.find((x) => x.id === pluginInstanceId) ?? null
}

/** Ahorro de energía: 30 fps si el navegador lo pide o la batería está baja y descargándose. */
function useFpsObjetivo(): number {
  const [fps, setFps] = useState(60)
  useEffect(() => {
    let cancelado = false
    const reducido = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reducido) setFps(30)
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; level: number; addEventListener: (t: string, f: () => void) => void }> }
    void nav.getBattery?.().then((b) => {
      const aplicar = () => !cancelado && setFps(reducido || (!b.charging && b.level < 0.3) ? 30 : 60)
      aplicar()
      b.addEventListener('chargingchange', aplicar)
      b.addEventListener('levelchange', aplicar)
    }).catch(() => undefined)
    return () => {
      cancelado = true
    }
  }, [])
  return fps
}

export function EditorVstWeb({ trackId, pluginInstanceId }: Props) {
  const tienda = useDAW()
  const plugin = useDAWState((s: DAWState) => pluginDe(s, trackId, pluginInstanceId))
  const layout = useMemo(() => (plugin ? layoutPorNombre(plugin.nombre) : null), [plugin?.nombre])
  const contenedor = useRef<HTMLDivElement>(null)
  const lienzo = useRef<HTMLCanvasElement>(null)
  const editor = useRef<EditorCyber | null>(null)
  const [ancho, setAncho] = useState(0)
  const [pestana, setPestana] = useState<Pestana>('controles')
  const [menu, setMenu] = useState<{ w: WidgetLayout; rect: RectCss } | null>(null)
  const [entrada, setEntrada] = useState<{ w: WidgetLayout; rect: RectCss; texto: string } | null>(null)
  const fps = useFpsObjetivo()
  const modo: Modo = modoPorAncho(ancho)

  // Valores: los del proyecto, con el gesto en curso por encima (se confirma al soltar: un paso de deshacer)
  const valores = useRef(new Map<number, number>())
  const gesto = useRef(new Map<number, number>())
  useEffect(() => {
    valores.current = new Map((plugin?.parametros ?? []).map((p) => [Number(p.id), p.valor]))
  }, [plugin])
  const defectos = useMemo(() => {
    const m = new Map<number, number>()
    for (const w of layout?.widgets ?? []) {
      const d = defDe(w)
      if (d && w.param !== undefined) m.set(w.param, normalizadoPorDefecto(d))
    }
    return m
  }, [layout])
  const valor = (param: number) => gesto.current.get(param) ?? valores.current.get(param) ?? defectos.get(param) ?? 0
  const nombreDe = (param: number) => layout?.widgets.find((w) => w.param === param && w.tipo !== 'section')?.nombre

  const confirmar = (param: number, n: number) => {
    const w = layout?.widgets.find((x) => x.param === param && x.nombre)
    const d = w ? defDe(w) : null
    void tienda.executor.execute('plugin.setParameter', {
      trackId,
      pluginInstanceId,
      parameterId: String(param),
      normalizedValue: n,
      ...(d ? { plainValue: aPlano(d, n) } : {}),
      ...(nombreDe(param) ? { name: nombreDe(param) } : {}),
    })
  }
  const cambiar = (param: number, n: number, fase: FaseCambio) => {
    if (fase === 'inicio') gesto.current.set(param, n)
    else if (fase === 'cambio') gesto.current.set(param, n)
    else if (fase === 'fin') {
      const final = gesto.current.get(param)
      gesto.current.delete(param)
      if (final !== undefined && final !== valores.current.get(param)) {
        valores.current.set(param, final)
        confirmar(param, final)
      }
    } else {
      valores.current.set(param, n)
      confirmar(param, n)
    }
  }
  const cambiarRef = useRef(cambiar)
  cambiarRef.current = cambiar
  const valorRef = useRef(valor)
  valorRef.current = valor

  // Ancho disponible (responsivo)
  useEffect(() => {
    const el = contenedor.current
    if (!el) return
    const ro = new ResizeObserver(() => setAncho(el.clientWidth))
    ro.observe(el)
    setAncho(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  // Editor Canvas, espectro de la pista y bucle de dibujo
  useEffect(() => {
    const canvas = lienzo.current
    if (!canvas || !layout) return
    const logo = new Image()
    logo.src = ISOTIPO
    const espectro = espectroDePista(trackId)
    const bins = espectro ? new Float32Array(espectro.fftSize / 2) : null
    const cols = new Float32Array(192)
    const ed = new EditorCyber(canvas, {
      layout,
      valor: (p) => valorRef.current(p),
      cambiar: (p, n, f) => cambiarRef.current(p, n, f),
      logo,
      avisoMedicion:
        'En la web el sonido de este VST no se procesa: los cambios se guardan en el proyecto y se aplican al abrirlo en JasWave para escritorio, donde se ve la medición en vivo.',
      espectro: () => {
        if (!espectro || !bins || !espectro.leer(bins)) return null
        columnasDesdeBins(bins, espectro.sampleRate, espectro.fftSize, cols.length, cols)
        // Solo la salida de la pista: sin el DSP del VST, entrada y salida serían la misma señal
        return { out: cols }
      },
      menu: (w, rect) => setMenu({ w, rect }),
      entradaNumerica: (w, rect) => {
        const d = defDe(w)
        if (!d || w.param === undefined) return
        setEntrada({ w, rect, texto: '' })
      },
    })
    editor.current = ed
    let ultimo = performance.now()
    let siguiente = 0
    let raf = 0
    const intervalo = 1000 / fps
    const bucle = (t: number) => {
      raf = requestAnimationFrame(bucle)
      if (t < siguiente) return
      siguiente = t + intervalo - 1
      ed.dibujar((t - ultimo) / 1000)
      ultimo = t
    }
    raf = requestAnimationFrame(bucle)
    return () => {
      cancelAnimationFrame(raf)
      ed.destruir()
      espectro?.liberar()
      editor.current = null
    }
  }, [layout, trackId, fps])

  // Vista según el ancho (16:9 entero, compacto o una pestaña)
  useEffect(() => {
    const ed = editor.current
    if (!ed || !layout || ancho <= 0) return
    ed.fijarVista(vistaDe(layout, modo, pestana))
    ed.redimensionar(ancho)
  }, [layout, ancho, modo, pestana])

  if (!plugin) return <p className="p-3 text-[11px] text-muted-foreground">El plugin ya no está en la pista.</p>
  if (!layout) return <p className="p-3 text-[11px] text-muted-foreground">«{plugin.nombre}» no es un VST de JasWave.</p>

  const elegir = (w: WidgetLayout, i: number) => {
    const d = defDe(w)
    setMenu(null)
    if (d && w.param !== undefined) cambiar(w.param, aNormalizado(d, i), 'unico')
  }
  const aceptarEntrada = () => {
    if (!entrada || entrada.w.param === undefined) return setEntrada(null)
    const d = defDe(entrada.w)
    const n = d ? interpretar(d, entrada.texto) : null
    if (n !== null) cambiar(entrada.w.param, n, 'unico')
    setEntrada(null)
  }
  const base = contenedor.current?.getBoundingClientRect()

  return (
    <div ref={contenedor} className="relative flex h-full min-h-0 flex-col overflow-auto bg-[#06080A]" data-testid="editor-vst-web" data-modo={modo}>
      {modo === 'pestanas' ? (
        <div className="flex shrink-0 border-b border-border" role="tablist" aria-label="Secciones del editor">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={pestana === p.id}
              onClick={() => setPestana(p.id)}
              className={`min-h-11 flex-1 text-[11px] font-semibold tracking-wider ${pestana === p.id ? 'text-accent-cyan' : 'text-muted-foreground'}`}
            >
              {p.titulo}
            </button>
          ))}
        </div>
      ) : null}
      <canvas ref={lienzo} className="block shrink-0" aria-label={`Editor de ${plugin.nombre}`} />
      {menu && base ? (
        <div className="fixed inset-0 z-50" onPointerDown={() => setMenu(null)}>
          <ul
            role="listbox"
            className="absolute max-h-72 overflow-auto rounded border border-border bg-panel py-1 shadow-xl"
            style={{ left: menu.rect.x, top: menu.rect.y + menu.rect.alto, minWidth: Math.max(140, menu.rect.ancho) }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {(menu.w.opciones ?? []).map((op, i) => (
              <li key={op}>
                <button
                  type="button"
                  role="option"
                  aria-selected={Math.round(valor(menu.w.param!) * (menu.w.pasos ?? 0)) === i}
                  onClick={() => elegir(menu.w, i)}
                  className="block min-h-9 w-full px-3 text-left text-[12px] text-foreground hover:bg-accent-cyan/15"
                >
                  {op}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {entrada ? (
        <div className="fixed inset-0 z-50" onPointerDown={() => setEntrada(null)}>
          <input
            autoFocus
            inputMode="decimal"
            aria-label={`Valor de ${entrada.w.etiqueta}`}
            value={entrada.texto}
            placeholder={entrada.w.unidad ? `valor (${entrada.w.unidad})` : 'valor'}
            onChange={(e) => setEntrada({ ...entrada, texto: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') aceptarEntrada()
              if (e.key === 'Escape') setEntrada(null)
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="absolute h-11 w-36 rounded border border-accent-cyan bg-panel px-2 text-center font-mono text-[14px] text-foreground"
            style={{ left: entrada.rect.x + entrada.rect.ancho / 2 - 72, top: entrada.rect.y + entrada.rect.alto / 2 - 22 }}
          />
        </div>
      ) : null}
    </div>
  )
}
