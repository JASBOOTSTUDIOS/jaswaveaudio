/**
 * Módulo «Partitura» de JasWave: editor de partitura sincronizado con el clip MIDI, vista previa y
 * exportación a PDF. Paquete independiente: solo usa el DAW a través de @jaswave/host-sdk.
 *
 * Ofrece el servicio `partitura` (lo usan las acciones score.exportClip / score.exportProject del DAW y
 * de la CLI) y añade sus acciones al menú de clip y a la barra del piano roll.
 */

import { FileDown, Music2 } from 'lucide-react'
import { definirModulo, getSharedStore, requestOpenTool, VERSION_SDK, type TiendaDAW } from '@jaswave/host-sdk'
import { ScorePreviewDialog } from './dialogo-vista-previa'
import { ScoreExportMenuListener } from './escucha-menu-exportar'
import { exportClipScorePdfDialog, exportProjectScoresToFolder } from './exportar'
import { ScoreEditorToolPanel } from './panel'
import './estilos.css'

export default definirModulo({
  id: 'com.jaswave.modulo.partitura',
  nombre: 'Partitura',
  version: '1.0.0',
  sdk: VERSION_SDK,
  herramientas: [
    { id: 'score-editor', titulo: 'Partitura', descripcion: 'Editor de partitura sincronizado con el clip MIDI', zona: 'bottom', icono: Music2, bajoDemanda: true },
  ],
  activar: () => ({
    paneles: { 'score-editor': ScoreEditorToolPanel },
    globales: [ScorePreviewDialog, ScoreExportMenuListener],
    servicios: {
      partitura: {
        exportarClipPdf: (tienda, pistaId, clipId) => exportClipScorePdfDialog(tienda as TiendaDAW, pistaId, clipId),
        exportarProyecto: (tienda, carpeta, incluirProyecto) => exportProjectScoresToFolder(tienda as TiendaDAW, carpeta, incluirProyecto),
      },
    },
    menus: {
      clip: [
        {
          id: 'partitura.abrir',
          etiqueta: 'Abrir editor de partitura',
          visible: (c) => c.tipo === 'midi',
          ejecutar: () => requestOpenTool('score-editor', { zone: 'bottom' }),
        },
        {
          id: 'partitura.exportar',
          etiqueta: 'Vista previa / exportar partitura PDF…',
          icono: FileDown,
          visible: (c) => c.tipo === 'midi',
          ejecutar: (c) => void exportClipScorePdfDialog(getSharedStore(), c.trackId, c.clipId),
        },
      ],
    },
  }),
})
