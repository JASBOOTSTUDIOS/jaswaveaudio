/**
 * Ajustes → IA (M2): modelos que la cuenta tiene permitidos (los gestiona el admin), preferencias del
 * asistente y, si el admin lo permite (`ia.modelo-propio`), los modelos propios del usuario.
 */

import { useEffect, useState } from 'react'
import { Plus, RefreshCw, Trash2 } from 'lucide-react'
import { loadAiSettings, saveAiSettings, type AiSettings } from '../motor/ai-settings'

import { refrescarCatalogoIA } from '../ia/catalogo-ia'
import { useCatalogoIA } from '../ia/use-catalogo-ia'
import { Aviso, Boton, CambiarClave, FormularioProveedorIA, Seccion, apiJasWave, puenteIAEscritorio } from '@jaswave/host-sdk'
import type { DatosProveedorIA, ProveedorIAApi } from '@jaswave/host-sdk'
import { EspecialistasPanel } from './especialistas-panel'
import { ConfigAgentePanel } from './config-agente-panel'
import { textoLegible } from './detalles-tecnicos'

export function AjustesIA() {
  const { catalogo, refrescar, error, sesion } = useCatalogoIA()
  const [ajustes, setAjustes] = useState<AiSettings>(() => loadAiSettings())
  const guardar = (a: AiSettings) => {
    saveAiSettings(a)
    setAjustes(a)
    window.dispatchEvent(new CustomEvent('jaswave-ai-settings-changed'))
  }
  // El catálogo cambia (sesión, permisos): se recalculan los perfiles.
  const actuales = loadAiSettings()
  const perfiles = actuales.providers

  if (sesion.sinConfigurar) return <Aviso>Esta versión de JasWave no tiene conexión con el servidor, así que el asistente no está disponible.</Aviso>
  if (!sesion.cargando && !sesion.session) {
    // La carpeta de configuración es local: se puede preparar aunque todavía no haya sesión.
    return (
      <div className="flex flex-col gap-3" data-testid="ajustes-ia">
        <Aviso>Inicia sesión en Cuenta para usar el asistente. Los modelos los asigna tu administrador.</Aviso>
        <ConfigAgentePanel />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3" data-testid="ajustes-ia">
      <Seccion
        titulo="Modelos disponibles"
        acciones={
          <Boton aria-label="Recargar modelos" onClick={() => void refrescar()}>
            <RefreshCw className="size-3.5" />
          </Boton>
        }
      >
        {error ? (
          <Aviso tipo="error">
            {textoLegible(error) || 'No se pudieron cargar los modelos. Revisa tu conexión e inténtalo de nuevo.'}
          </Aviso>
        ) : null}
        {!catalogo.permisos.usar ? (
          <Aviso>Tu cuenta no tiene acceso al asistente. Pídeselo a tu administrador.</Aviso>
        ) : !perfiles.length ? (
          <Aviso>No tienes modelos asignados todavía.</Aviso>
        ) : (
          <ul className="flex flex-col gap-1">
            {perfiles.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px]">
                <input
                  type="radio"
                  name="proveedor-ia"
                  aria-label={`Usar ${p.name}`}
                  checked={actuales.activeProviderId === p.id}
                  onChange={() => guardar({ ...actuales, activeProviderId: p.id })}
                />
                <span className="min-w-0 flex-1 truncate text-foreground">{p.name}</span>
                <select
                  aria-label={`Modelo de ${p.name}`}
                  value={p.selectedModel}
                  onChange={(e) =>
                    guardar({ ...actuales, providers: actuales.providers.map((x) => (x.id === p.id ? { ...x, selectedModel: e.target.value } : x)) })
                  }
                  className="rounded-md border border-border bg-panel-raised px-1.5 py-0.5 text-[11px]"
                >
                  {p.models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          <label className="flex items-center gap-1" title="0 = respuestas más precisas; valores altos = más creativas">
            Creatividad
            <input
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={ajustes.temperature}
              onChange={(e) => guardar({ ...actuales, temperature: Number(e.target.value) })}
              className="w-14 rounded-md border border-border bg-panel-raised px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1" title="Cuánto puede escribir el asistente en cada respuesta">
            Longitud máxima de respuesta
            <input
              type="number"
              min={256}
              max={128000}
              step={256}
              value={ajustes.maxTokens}
              onChange={(e) => guardar({ ...actuales, maxTokens: Number(e.target.value) })}
              className="w-20 rounded-md border border-border bg-panel-raised px-1.5 py-0.5"
            />
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={ajustes.fallbackEnabled !== false}
              onChange={(e) => guardar({ ...actuales, fallbackEnabled: e.target.checked })}
            />
            Si un modelo falla, probar otro
          </label>
          <InterruptorInternetIA />
        </div>
      </Seccion>

      <ConfigAgentePanel />

      <EspecialistasPanel />

      {catalogo.permisos.modeloPropio ? <MisModelos /> : null}
    </div>
  )
}

type PuenteWebTools = {
  internetPermitido: () => Promise<boolean>
  fijarInternetPermitido: (activo: boolean) => Promise<boolean>
}

/** «Permitir a la IA usar internet» (K6): la preferencia vive en el proceso main; solo existe en la app de escritorio. */
function InterruptorInternetIA() {
  const puente = (window as unknown as { electron?: { webTools?: PuenteWebTools } }).electron?.webTools
  const [activo, setActivo] = useState(true)
  useEffect(() => {
    let vivo = true
    void puente?.internetPermitido().then((v) => vivo && setActivo(Boolean(v))).catch(() => {})
    return () => {
      vivo = false
    }
  }, [puente])
  if (!puente) return null
  return (
    <label className="flex items-center gap-1" title="Búsquedas web, páginas, YouTube y análisis de referencias. Desactívalo para que la IA no salga a internet.">
      <input
        type="checkbox"
        checked={activo}
        onChange={(e) => {
          const v = e.target.checked
          setActivo(v)
          void puente.fijarInternetPermitido(v).then((r) => setActivo(Boolean(r))).catch(() => setActivo(!v))
        }}
      />
      Permitir a la IA usar internet
    </label>
  )
}

function MisModelos() {
  const { catalogo } = useCatalogoIA()
  const propios = catalogo.proveedores.filter((p) => p.origen === 'propio')
  const [creando, setCreando] = useState(false)
  const [editando, setEditando] = useState<string | null>(null)
  const [aviso, setAviso] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null)
  const escritorio = puenteIAEscritorio() !== null

  const ejecutar = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn()
      await refrescarCatalogoIA()
      setAviso({ tipo: 'ok', texto: ok })
    } catch (e) {
      setAviso({
        tipo: 'error',
        texto: textoLegible(e instanceof Error ? e.message : String(e)) || 'No se pudo completar. Revisa los datos e inténtalo de nuevo.',
      })
      throw e
    }
  }

  return (
    <Seccion
      titulo="Mis modelos"
      acciones={
        <Boton onClick={() => setCreando(true)} disabled={creando}>
          <Plus className="mr-1 inline size-3" />
          Añadir
        </Boton>
      }
    >
      <Aviso>
        Tu administrador te permite usar tus propios modelos.
        {escritorio ? ' Los de «este equipo» (p. ej. Ollama local) se ejecutan aquí; los demás, en el servidor.' : ' En la web solo funcionan los de URL pública.'}
      </Aviso>
      {aviso ? <Aviso tipo={aviso.tipo}>{aviso.texto}</Aviso> : null}
      {creando ? (
        <FormularioProveedorIA
          modo="propio"
          permitirLocal={escritorio}
          onCancelar={() => setCreando(false)}
          onGuardar={(d: DatosProveedorIA) => ejecutar(() => apiJasWave().ia.crearPropio(d), 'Modelo añadido.').then(() => setCreando(false))}
        />
      ) : null}
      <ul className="flex flex-col gap-1">
        {propios.map((p: ProveedorIAApi) =>
          editando === p.id ? (
            <li key={p.id}>
              <FormularioProveedorIA
                modo="propio"
                inicial={p}
                permitirLocal={escritorio}
                onCancelar={() => setEditando(null)}
                onGuardar={(d) => ejecutar(() => apiJasWave().ia.actualizarPropio(p.id, d), 'Cambios guardados.').then(() => setEditando(null))}
              />
            </li>
          ) : (
            <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-2 py-1.5 text-[11px]">
              <span className="min-w-0 flex-1 truncate text-foreground">
                {p.nombre} · <span className="text-muted-foreground">{p.ejecucion === 'local' ? 'este equipo' : 'servidor'}</span>
                {p.tieneClave ? <span className="ml-1 text-muted-foreground">· con clave</span> : null}
              </span>
              <Boton onClick={() => setEditando(p.id)}>Editar</Boton>
              <CambiarClave onGuardar={(c) => ejecutar(() => apiJasWave().ia.clavePropia(p.id, c), c ? 'Clave guardada.' : 'Clave eliminada.')} />
              <Boton aria-label={`Eliminar ${p.nombre}`} onClick={() => void ejecutar(() => apiJasWave().ia.eliminarPropio(p.id), 'Modelo eliminado.').catch(() => {})}>
                <Trash2 className="size-3.5" />
              </Boton>
            </li>
          ),
        )}
      </ul>
    </Seccion>
  )
}
