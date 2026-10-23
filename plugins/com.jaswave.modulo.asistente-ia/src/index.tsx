/**
 * Módulo «Asistente Jas (IA)»: coproductor con IA (chat, agente, plan y progreso). Paquete independiente:
 * todo lo que necesita del DAW lo toma de @jaswave/host-sdk (acciones, estado, documentos, plugins…).
 * Los modelos y sus permisos los gestiona el backend (ver ia/catalogo-ia.ts).
 */

import { definirModulo, fijarConversacionActiva, JasWaveLogo, VERSION_SDK } from '@jaswave/host-sdk'
import { AjustesIA } from './ui/ajustes-ia'
import { CoProducerPanel } from './ui/coproducer-panel'
import { ProgressPanel } from './ui/progress-panel'
import { bumpChatTextZoom, isChatZoomTarget, setChatTextZoom } from './motor/chat-ui-store'
import { refrescarCatalogoIA } from './ia/catalogo-ia'
import './estilos.css'

const Logo = ({ className }: { className?: string }) => <JasWaveLogo className={className} alt="" />

export default definirModulo({
  id: 'com.jaswave.modulo.asistente-ia',
  nombre: 'Asistente Jas (IA)',
  version: '1.0.1',
  sdk: VERSION_SDK,
  herramientas: [
    { id: 'coproducer', titulo: 'Asistente Jas', descripcion: 'Asistente JasWave', zona: 'left', icono: Logo, destacada: true },
    { id: 'progress', titulo: 'Progreso', descripcion: 'Plan, bitácora, diffs y métricas (A9)', zona: 'right', bajoDemanda: true },
  ],
  activar: () => {
    // El panel Admin → IA avisa cuando cambian proveedores o permisos.
    const recargar = () => void refrescarCatalogoIA().catch(() => {})
    window.addEventListener('jaswave-ia-catalogo-invalidado', recargar)
    return {
      paneles: { coproducer: CoProducerPanel, progress: ProgressPanel },
      ajustes: [{ id: 'ia', titulo: 'IA', componente: AjustesIA }],
      zoom: { esObjetivo: () => isChatZoomTarget(), cambiar: (d) => bumpChatTextZoom(d), restablecer: () => setChatTextZoom(1) },
      desactivar: () => {
        window.removeEventListener('jaswave-ia-catalogo-invalidado', recargar)
        fijarConversacionActiva(null)
      },
    }
  },
})
