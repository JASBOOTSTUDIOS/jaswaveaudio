/**
 * La administración vive en JasWave Admin, una app aparte del DAW (admin.html). Esta herramienta solo
 * queda como acceso (p. ej. diseños de espacio de trabajo guardados que aún la tengan abierta).
 */

import { useState } from 'react'
import { ExternalLink, ShieldCheck } from 'lucide-react'
import { abrirAppAdmin } from '@/src/admin-app/abrir'
import { useSesion } from '@/src/lib/backend/sesion'

export function PanelAbrirAdmin() {
  const sesion = useSesion()
  const [error, setError] = useState<string | null>(null)
  const esAdmin = Boolean(sesion.identidad?.esAdmin)
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <ShieldCheck className="size-7 text-[#19D9FF]" />
      <p className="text-[13px] text-foreground">La administración se abre en JasWave Admin, una app aparte del DAW.</p>
      {sesion.cargando ? null : esAdmin ? (
        <button
          type="button"
          onClick={() => void abrirAppAdmin().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
          className="flex items-center gap-1.5 rounded-md border border-[#19D9FF]/50 bg-[#19D9FF]/10 px-3 py-1.5 text-[12px] text-[#19D9FF] shadow-[0_0_14px_-4px_rgba(25,217,255,0.6)] hover:bg-[#19D9FF]/20"
        >
          <ExternalLink className="size-3.5" /> Abrir JasWave Admin
        </button>
      ) : (
        <p className="text-[12px] text-muted-foreground">Acceso solo para administradores.</p>
      )}
      {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
    </div>
  )
}
