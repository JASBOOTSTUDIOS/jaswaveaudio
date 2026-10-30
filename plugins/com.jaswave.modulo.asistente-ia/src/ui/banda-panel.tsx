/**
 * Panel propio de la banda virtual: lo mismo que se ve en el chat, para tenerlo aparte y no quitarle
 * espacio a la conversación.
 */
import { useEffect } from 'react'
import { BandaLiveOrchestrator } from './banda-live-orchestrator'
import { registrarPanelBanda } from './banda-vista-store'
import { MiEstiloPanel } from './mi-estilo-panel'

export function BandaPanel() {
  // Mientras esté abierto, el chat sabe que puede ceder la tarjeta (si el usuario eligió verla aparte).
  useEffect(() => {
    console.info('[banda] vista: panel aparte montado')
    return registrarPanelBanda()
  }, [])
  return (
    <div data-testid="banda-panel" className="h-full space-y-2 overflow-y-auto bg-panel-base/70 p-2">
      <MiEstiloPanel />
      <BandaLiveOrchestrator enPanel />
    </div>
  )
}
