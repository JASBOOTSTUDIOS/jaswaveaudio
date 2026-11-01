/**
 * Módulo «Documentos del proyecto»: editor (pestañas, vista previa con diagramas) y explorador de docs/.
 * Ofrece el servicio `documentos` para que el DAW y otros módulos (p. ej. el asistente) abran documentos.
 */

import { FileText, FolderOpen } from 'lucide-react'
import { definirModulo, requestOpenTool, VERSION_SDK } from '@jaswave/host-sdk'
import { bumpDocsTextZoom, isDocsZoomTarget, openDocsTab, setDocsTextZoom } from './editor-store'
import { AgentDocsPanel } from './panel-docs'
import { DocsExplorerPanel } from './panel-explorador'
import './estilos.css'

export default definirModulo({
  id: 'com.jaswave.modulo.documentos',
  nombre: 'Documentos del proyecto',
  version: '1.0.0',
  sdk: VERSION_SDK,
  herramientas: [
    { id: 'docs', titulo: 'Docs', descripcion: 'Tabs de edición y vista de Markdown del proyecto', zona: 'left', icono: FileText, bajoDemanda: true },
    { id: 'docs-explorer', titulo: 'Explorador', descripcion: 'Árbol de docs/ del proyecto (plan.md y contextos)', zona: 'left', icono: FolderOpen },
  ],
  activar: () => ({
    paneles: { docs: AgentDocsPanel, 'docs-explorer': DocsExplorerPanel },
    servicios: {
      documentos: {
        abrir: (slug, modo = 'edit') => {
          openDocsTab(slug, modo)
          requestOpenTool('docs', { zone: 'left' })
        },
      },
    },
    zoom: { esObjetivo: () => isDocsZoomTarget(), cambiar: (d) => bumpDocsTextZoom(d), restablecer: () => setDocsTextZoom(1) },
  }),
})
