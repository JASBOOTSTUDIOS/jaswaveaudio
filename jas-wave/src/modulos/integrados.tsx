/**
 * Transitorio (M3 → M4/M5): módulos cuyo código aún vive dentro del DAW. Se registran con el mismo
 * contrato que los paquetes externos (DefinicionModulo del SDK) y se cargan en un chunk diferido; cada
 * uno se elimina de aquí al pasar a su paquete en plugins/.
 */

import { definirModulo } from '@jaswave/host-sdk/contrato'
import { VERSION_SDK } from '@jaswave/host-sdk/runtime'
import { registrarModulo } from './registro-modulos'

let registrados = false

export function registrarModulosIntegrados(): void {
  if (registrados) return
  registrados = true

  void registrarModulo({
    id: 'asistente-ia',
    nombre: 'Asistente Jas (IA)',
    descripcion:
      'Coproductor con IA: chat, agente que edita el proyecto con comandos deshacibles, plan.md, docs del proyecto y progreso.',
    version: '1.0.0',
    origen: 'instalado',
    cargar: async () => {
      const [{ CoProducerPanel }, { AgentDocsPanel }, { DocsExplorerPanel }, { ProgressPanel }, { JasWaveLogo }] = await Promise.all([
        import('@/components/coproducer-panel'),
        import('@/components/agent-docs-panel'),
        import('@/components/docs-explorer-panel'),
        import('@/components/progress-panel'),
        import('@/components/brand'),
      ])
      const Logo = ({ className }: { className?: string }) => <JasWaveLogo className={className} alt="" />
      return definirModulo({
        id: 'asistente-ia',
        nombre: 'Asistente Jas (IA)',
        version: '1.0.0',
        sdk: VERSION_SDK,
        herramientas: [
          { id: 'coproducer', titulo: 'Asistente Jas', descripcion: 'Asistente JasWave', zona: 'left', icono: Logo },
          { id: 'docs', titulo: 'Docs', descripcion: 'Tabs de edición y vista de Markdown del proyecto', zona: 'left', bajoDemanda: true },
          { id: 'docs-explorer', titulo: 'Explorador', descripcion: 'Árbol de docs/ del proyecto (plan.md y contextos)', zona: 'left' },
          { id: 'progress', titulo: 'Progreso', descripcion: 'Plan, bitácora, diffs y métricas (A9)', zona: 'right', bajoDemanda: true },
        ],
        activar: () => ({
          paneles: { coproducer: CoProducerPanel, docs: AgentDocsPanel, 'docs-explorer': DocsExplorerPanel, progress: ProgressPanel },
        }),
      })
    },
  })
}
