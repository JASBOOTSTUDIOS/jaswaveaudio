/**
 * Instalación de extensiones `.jwx` (X1), como los `.vsix` de VS Code: arrastrar el archivo a cualquier
 * parte de la ventana, abrirlo con doble clic o «Instalar desde archivo…» en Módulos. Siempre se muestra
 * qué se va a instalar y el estado de su firma antes de instalar; sin firma de JasWave solo se puede
 * con el Modo desarrollador (y lo confirma el usuario).
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, PackageOpen, ShieldAlert, ShieldCheck, ShieldX, X } from 'lucide-react'
import {
  extensionesDisponibles,
  formatoTamano,
  inspeccionarJwx,
  instalarJwx,
  rutaDeArchivoSoltado,
  type InspeccionJwx,
} from '@/src/lib/plugins/extensiones'

/** Otros componentes (panel Módulos) piden instalar un .jwx ya elegido con este evento. */
export const EVENTO_INSTALAR_JWX = 'jaswave-instalar-jwx'
export function pedirInstalacionJwx(ruta: string): void {
  window.dispatchEvent(new CustomEvent(EVENTO_INSTALAR_JWX, { detail: { ruta } }))
}

type Estado =
  | { fase: 'cerrado' }
  | { fase: 'inspeccionando'; ruta: string }
  | { fase: 'confirmar'; ruta: string; paquete: InspeccionJwx; modoDev: boolean }
  | { fase: 'instalando'; ruta: string; paquete: InspeccionJwx }
  | { fase: 'hecho'; paquete: InspeccionJwx; mensaje: string }
  | { fase: 'error'; mensaje: string; paquete?: InspeccionJwx }

export function InstaladorExtensiones() {
  const [estado, setEstado] = useState<Estado>({ fase: 'cerrado' })
  const [arrastrando, setArrastrando] = useState(false)

  const abrir = useCallback(async (ruta: string) => {
    setEstado({ fase: 'inspeccionando', ruta })
    const r = await inspeccionarJwx(ruta)
    if (!r.ok) {
      setEstado({ fase: 'error', mensaje: r.error })
      return
    }
    const modoDev = Boolean(await window.electron?.modoDesarrollador?.())
    setEstado({ fase: 'confirmar', ruta, paquete: r.paquete, modoDev })
  }, [])

  const instalar = useCallback(async (ruta: string, paquete: InspeccionJwx, aceptarSinFirma: boolean) => {
    setEstado({ fase: 'instalando', ruta, paquete })
    const r = await instalarJwx(ruta, aceptarSinFirma)
    if (r.ok) {
      setEstado({
        fase: 'hecho',
        paquete,
        mensaje:
          paquete.tipo === 'modulo'
            ? 'Instalado. Ya aparece en Módulos: actívalo para usarlo.'
            : 'Instalado. El plugin ya está disponible en Instrumentos y efectos.',
      })
    } else setEstado({ fase: 'error', mensaje: r.error, paquete })
  }, [])

  // Doble clic sobre un .jwx (main lo entrega) y petición desde el panel Módulos
  useEffect(() => {
    if (!extensionesDisponibles()) return
    const quitar = window.electron?.onExtensionSolicitada?.((ruta) => void abrir(ruta))
    void window.electron?.extensionPendiente?.().then((ruta) => {
      if (ruta) void abrir(ruta)
    })
    const alPedir = (e: Event) => {
      const ruta = (e as CustomEvent<{ ruta?: string }>).detail?.ruta
      if (typeof ruta === 'string') void abrir(ruta)
    }
    window.addEventListener(EVENTO_INSTALAR_JWX, alPedir)
    return () => {
      quitar?.()
      window.removeEventListener(EVENTO_INSTALAR_JWX, alPedir)
    }
  }, [abrir])

  // Arrastrar un .jwx a cualquier parte de la ventana
  useEffect(() => {
    if (!extensionesDisponibles()) return
    const tieneJwx = (e: DragEvent) => [...(e.dataTransfer?.items ?? [])].some((i) => i.kind === 'file') && [...(e.dataTransfer?.types ?? [])].includes('Files')
    const sobre = (e: DragEvent) => {
      if (!tieneJwx(e)) return
      e.preventDefault()
      setArrastrando(true)
    }
    const fuera = (e: DragEvent) => {
      if (e.relatedTarget === null) setArrastrando(false)
    }
    const soltar = (e: DragEvent) => {
      setArrastrando(false)
      const archivos = [...(e.dataTransfer?.files ?? [])]
      const jwx = archivos.map(rutaDeArchivoSoltado).find((r): r is string => !!r)
      if (!jwx) return
      // Solo los .jwx: el resto de soltados (audio, MIDI…) siguen su camino habitual
      e.preventDefault()
      e.stopPropagation()
      void abrir(jwx)
    }
    window.addEventListener('dragover', sobre)
    window.addEventListener('dragleave', fuera)
    window.addEventListener('drop', soltar, true)
    return () => {
      window.removeEventListener('dragover', sobre)
      window.removeEventListener('dragleave', fuera)
      window.removeEventListener('drop', soltar, true)
    }
  }, [abrir])

  const cerrar = () => setEstado({ fase: 'cerrado' })

  return (
    <>
      {arrastrando ? (
        <div className="pointer-events-none fixed inset-3 z-[55] flex items-center justify-center rounded-xl border-2 border-dashed border-accent-cyan/60 bg-background/40">
          <div className="flex items-center gap-2 rounded-lg bg-panel px-4 py-2 text-[12px] text-foreground shadow-xl">
            <PackageOpen className="size-4 text-accent-cyan" />
            Suelta un archivo .jwx para instalar la extensión
          </div>
        </div>
      ) : null}
      {estado.fase !== 'cerrado' ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-label="Instalar extensión" data-testid="dialogo-instalar-jwx">
          <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-panel p-5 shadow-2xl">
            <div className="flex items-center gap-2">
              <PackageOpen className="size-5 text-accent-cyan" />
              <h3 className="flex-1 text-[14px] font-semibold text-foreground">Instalar extensión</h3>
              {estado.fase !== 'instalando' ? (
                <button type="button" aria-label="Cerrar" onClick={cerrar} className="rounded p-1 text-muted-foreground hover:text-foreground">
                  <X className="size-4" />
                </button>
              ) : null}
            </div>
            {estado.fase === 'inspeccionando' ? (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Verificando el paquete…
              </p>
            ) : null}
            {'paquete' in estado && estado.paquete ? <FichaPaquete paquete={estado.paquete} /> : null}
            {estado.fase === 'confirmar' ? (
              <Confirmacion estado={estado} onCancelar={cerrar} onInstalar={(sinFirma) => void instalar(estado.ruta, estado.paquete, sinFirma)} />
            ) : null}
            {estado.fase === 'instalando' ? (
              <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Instalando…
              </p>
            ) : null}
            {estado.fase === 'hecho' ? (
              <>
                <p className="text-[12px] text-emerald-400" data-testid="jwx-instalado">{estado.mensaje}</p>
                <div className="flex justify-end">
                  <button type="button" onClick={cerrar} className="rounded-md bg-accent-cyan px-3 py-1.5 text-[12px] font-semibold text-background">
                    Aceptar
                  </button>
                </div>
              </>
            ) : null}
            {estado.fase === 'error' ? (
              <>
                <p className="whitespace-pre-wrap text-[12px] text-red-400" data-testid="jwx-error">{estado.mensaje}</p>
                <div className="flex justify-end">
                  <button type="button" onClick={cerrar} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-border hover:text-foreground">
                    Cerrar
                  </button>
                </div>
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

function FichaPaquete({ paquete }: { paquete: InspeccionJwx }) {
  const firma =
    paquete.firma === 'valida' ? (
      <span className="inline-flex items-center gap-1 text-emerald-400" data-testid="jwx-firma">
        <ShieldCheck className="size-3.5" /> Firmado por JasWave
      </span>
    ) : paquete.firma === 'ausente' ? (
      <span className="inline-flex items-center gap-1 text-amber-400" data-testid="jwx-firma">
        <ShieldAlert className="size-3.5" /> Sin firmar
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-red-400" data-testid="jwx-firma">
        <ShieldX className="size-3.5" /> Firma inválida{paquete.motivoFirma ? `: ${paquete.motivoFirma}` : ''}
      </span>
    )
  return (
    <div className="flex flex-col gap-1 rounded-md bg-background/60 p-3 text-[12px]">
      <div className="font-semibold text-foreground">
        {paquete.nombre} <span className="font-normal text-muted-foreground">v{paquete.version}</span>
      </div>
      <div className="font-mono text-[10px] text-muted-foreground">{paquete.id}</div>
      {paquete.descripcion ? <p className="text-muted-foreground">{paquete.descripcion}</p> : null}
      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span className="text-muted-foreground">{paquete.tipo === 'modulo' ? 'Módulo del DAW' : 'Plugin VST3'}</span>
        <span className="text-muted-foreground">{formatoTamano(paquete.tamano)}</span>
        {firma}
      </div>
    </div>
  )
}

function Confirmacion({
  estado,
  onCancelar,
  onInstalar,
}: {
  estado: Extract<Estado, { fase: 'confirmar' }>
  onCancelar: () => void
  onInstalar: (sinFirma: boolean) => void
}) {
  const firmado = estado.paquete.firma === 'valida'
  return (
    <>
      {!firmado && !estado.modoDev ? (
        <p className="text-[12px] text-red-400" data-testid="jwx-bloqueado">
          Solo se instalan extensiones firmadas por JasWave. Si es una extensión tuya en desarrollo, activa el Modo desarrollador en
          Módulos y vuelve a abrirla.
        </p>
      ) : null}
      {!firmado && estado.modoDev ? (
        <p className="text-[12px] text-amber-400">
          Modo desarrollador: puedes instalarla, pero su código no está verificado por JasWave y se ejecutará dentro del DAW. Instálala solo
          si confías en quien te la dio.
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancelar} className="rounded-md px-3 py-1.5 text-[12px] ring-1 ring-border hover:text-foreground">
          Cancelar
        </button>
        {firmado ? (
          <button type="button" onClick={() => onInstalar(false)} className="rounded-md bg-accent-cyan px-3 py-1.5 text-[12px] font-semibold text-background">
            Instalar
          </button>
        ) : estado.modoDev ? (
          <button type="button" onClick={() => onInstalar(true)} className="rounded-md bg-amber-600 px-3 py-1.5 text-[12px] font-semibold text-white">
            Instalar sin firma
          </button>
        ) : null}
      </div>
    </>
  )
}
