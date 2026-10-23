/**
 * Formulario de proveedor de IA (M2): lo usan el panel Admin → IA (proveedores para los roles) y
 * Ajustes → IA → Mis modelos (modelos propios, si el admin lo permite). La clave se envía una vez al
 * backend, que la guarda cifrada; nunca se vuelve a mostrar.
 */

import { useEffect, useMemo, useState } from 'react'
import { PROVIDER_PRESETS, type AiApiStyle, type AiAuthStyle, type AiProviderCustom, type AiProviderKind } from '@/src/lib/ai-settings'
import type { DatosProveedorIA, ProveedorIAApi } from '@/src/lib/backend/api'
import { Boton, Campo, Selector } from '@/components/cuenta/ui'

export const TIPOS_IA: AiProviderKind[] = ['openai-compatible', 'ollama', 'openai', 'anthropic', 'gemini', 'openrouter', 'kilocode']

/** Campos avanzados para un proveedor compatible con OpenAI u otro endpoint propio. */
export function CamposAvanzadosProveedor({ value, onChange }: { value: AiProviderCustom; onChange: (next: AiProviderCustom) => void }) {
  const texto = useMemo(() => JSON.stringify(value.extraHeaders ?? {}), [value.extraHeaders])
  const [borrador, setBorrador] = useState(texto)
  useEffect(() => setBorrador(texto), [texto])
  const cambiar = (p: Partial<AiProviderCustom>) => onChange({ ...value, ...p })

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed border-border/80 p-2.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Parámetros del endpoint</span>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Selector etiqueta="Estilo de API" value={value.apiStyle ?? 'openai'} onChange={(e) => cambiar({ apiStyle: e.target.value as AiApiStyle })}>
          <option value="openai">OpenAI-compatible</option>
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
          <option value="ollama">Ollama</option>
        </Selector>
        <Selector etiqueta="Autenticación" value={value.authStyle ?? 'bearer'} onChange={(e) => cambiar({ authStyle: e.target.value as AiAuthStyle })}>
          <option value="bearer">Bearer (Authorization)</option>
          <option value="x-api-key">x-api-key</option>
          <option value="none">Sin autenticación</option>
        </Selector>
        <Campo etiqueta="Ruta de chat" value={value.chatPath ?? '/chat/completions'} onChange={(e) => cambiar({ chatPath: e.target.value })} />
        <Campo etiqueta="Ruta de modelos" value={value.modelsPath ?? '/models'} onChange={(e) => cambiar({ modelsPath: e.target.value })} />
      </div>
      <label className="flex items-center gap-2 text-[11px] text-foreground">
        <input type="checkbox" checked={value.appendV1 === true} onChange={(e) => cambiar({ appendV1: e.target.checked })} />
        Añadir /v1 a la URL base si falta
      </label>
      <label className="flex items-center gap-2 text-[11px] text-foreground">
        <input type="checkbox" checked={value.needsApiKey !== false} onChange={(e) => cambiar({ needsApiKey: e.target.checked })} />
        Requiere API key
      </label>
      <Campo
        etiqueta="Cabeceras extra (JSON)"
        value={borrador}
        onChange={(e) => setBorrador(e.target.value)}
        onBlur={() => {
          try {
            const h = JSON.parse(borrador || '{}') as Record<string, string>
            if (h && typeof h === 'object' && !Array.isArray(h)) cambiar({ extraHeaders: h })
          } catch {
            setBorrador(texto)
          }
        }}
      />
    </div>
  )
}

export type ModoFormulario = 'admin' | 'propio'

/** Alta o edición. En edición la clave se cambia aparte (solo escritura). */
export function FormularioProveedorIA({
  modo,
  inicial,
  permitirLocal,
  onGuardar,
  onCancelar,
}: {
  modo: ModoFormulario
  inicial?: ProveedorIAApi
  /** Solo escritorio: el modelo propio puede ejecutarse en este equipo. */
  permitirLocal?: boolean
  onGuardar: (datos: DatosProveedorIA & { slug?: string }) => Promise<void>
  onCancelar: () => void
}) {
  const [tipo, setTipo] = useState<AiProviderKind>((inicial?.tipo as AiProviderKind) ?? 'openai-compatible')
  const preset = PROVIDER_PRESETS[tipo]
  const [slug, setSlug] = useState(inicial?.slug ?? '')
  const [nombre, setNombre] = useState(inicial?.nombre ?? '')
  const [baseUrl, setBaseUrl] = useState(inicial?.baseUrl ?? preset.defaultBaseUrl)
  const [modelos, setModelos] = useState((inicial?.modelos ?? [preset.defaultModel]).filter(Boolean).join(', '))
  const [modeloPorDefecto, setModeloPorDefecto] = useState(inicial?.modeloPorDefecto ?? '')
  const [apiKey, setApiKey] = useState('')
  const [ejecucion, setEjecucion] = useState<'servidor' | 'local'>(inicial?.ejecucion ?? (permitirLocal ? 'local' : 'servidor'))
  const [herramientas, setHerramientas] = useState<'auto' | 'si' | 'no'>(inicial?.herramientas == null ? 'auto' : inicial.herramientas ? 'si' : 'no')
  const [porMinuto, setPorMinuto] = useState(String(inicial?.peticionesPorMinuto ?? 30))
  const [custom, setCustom] = useState<AiProviderCustom>((inicial?.custom as AiProviderCustom | null) ?? {})
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const elegirTipo = (t: AiProviderKind) => {
    setTipo(t)
    if (!inicial) {
      setBaseUrl(PROVIDER_PRESETS[t].defaultBaseUrl)
      setModelos(PROVIDER_PRESETS[t].defaultModel)
    }
  }

  const guardar = async () => {
    const lista = modelos.split(',').map((m) => m.trim()).filter(Boolean)
    if (!nombre.trim() || !baseUrl.trim() || !lista.length) {
      setError('Nombre, URL y al menos un modelo son obligatorios.')
      return
    }
    setOcupado(true)
    setError(null)
    try {
      await onGuardar({
        ...(modo === 'admin' && !inicial ? { slug: slug.trim() } : {}),
        nombre: nombre.trim(),
        tipo,
        baseUrl: baseUrl.trim(),
        modelos: lista,
        ...(modeloPorDefecto.trim() ? { modeloPorDefecto: modeloPorDefecto.trim() } : {}),
        herramientas: herramientas === 'auto' ? null : herramientas === 'si',
        ...(tipo === 'openai-compatible' || tipo === 'kilocode' ? { custom } : {}),
        ...(!inicial && apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(modo === 'propio' ? { ejecucion } : {}),
        ...(modo === 'admin' && Number(porMinuto) > 0 ? { peticionesPorMinuto: Number(porMinuto) } : {}),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-panel-raised/30 p-3" data-testid="formulario-proveedor-ia">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {modo === 'admin' && !inicial ? (
          <Campo etiqueta="Identificador (slug)" value={slug} onChange={(e) => setSlug(e.target.value)} ayuda="Acción de permiso: ia.proveedor.<slug>" />
        ) : null}
        <Campo etiqueta="Nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => elegirTipo(e.target.value as AiProviderKind)}>
          {TIPOS_IA.map((t) => (
            <option key={t} value={t}>
              {PROVIDER_PRESETS[t].label}
            </option>
          ))}
        </Selector>
        <Campo etiqueta="URL base" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} ayuda={preset.hint} />
        <Campo etiqueta="Modelos (separados por coma)" value={modelos} onChange={(e) => setModelos(e.target.value)} />
        <Campo etiqueta="Modelo por defecto" value={modeloPorDefecto} onChange={(e) => setModeloPorDefecto(e.target.value)} placeholder="el primero de la lista" />
        {!inicial ? (
          <Campo etiqueta="API key" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} ayuda="Se guarda cifrada en el servidor y no se vuelve a mostrar." />
        ) : null}
        <Selector etiqueta="Herramientas nativas" value={herramientas} onChange={(e) => setHerramientas(e.target.value as 'auto' | 'si' | 'no')}>
          <option value="auto">Automático</option>
          <option value="si">Sí</option>
          <option value="no">No</option>
        </Selector>
        {modo === 'admin' ? (
          <Campo etiqueta="Peticiones por minuto y usuario" type="number" min={1} value={porMinuto} onChange={(e) => setPorMinuto(e.target.value)} />
        ) : (
          <Selector etiqueta="Dónde se ejecuta" value={ejecucion} onChange={(e) => setEjecucion(e.target.value as 'servidor' | 'local')}>
            {permitirLocal || ejecucion === 'local' ? <option value="local">En este equipo (JasWave Desktop)</option> : null}
            <option value="servidor">En el servidor de JasWave (URL pública)</option>
          </Selector>
        )}
      </div>
      {tipo === 'openai-compatible' || tipo === 'kilocode' ? <CamposAvanzadosProveedor value={custom} onChange={setCustom} /> : null}
      {error ? (
        <p role="alert" className="text-[11px] text-red-400">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Boton onClick={onCancelar}>Cancelar</Boton>
        <Boton primario disabled={ocupado} onClick={() => void guardar()}>
          {inicial ? 'Guardar cambios' : 'Añadir'}
        </Boton>
      </div>
    </div>
  )
}

/** Cambiar (o quitar) la clave de un proveedor: solo escritura. */
export function CambiarClave({ onGuardar }: { onGuardar: (clave: string | null) => Promise<void> }) {
  const [abierto, setAbierto] = useState(false)
  const [clave, setClave] = useState('')
  if (!abierto) return <Boton onClick={() => setAbierto(true)}>Clave…</Boton>
  return (
    <span className="flex items-center gap-1">
      <input
        type="password"
        autoComplete="off"
        aria-label="Nueva API key"
        value={clave}
        onChange={(e) => setClave(e.target.value)}
        className="w-40 rounded-md border border-border bg-panel-raised px-2 py-1 text-[11px]"
      />
      <Boton
        primario
        disabled={!clave.trim()}
        onClick={() =>
          void onGuardar(clave.trim()).then(() => {
            setClave('')
            setAbierto(false)
          })
        }
      >
        Guardar
      </Boton>
      <Boton onClick={() => void onGuardar(null).then(() => setAbierto(false))}>Quitar</Boton>
      <Boton onClick={() => setAbierto(false)}>×</Boton>
    </span>
  )
}
