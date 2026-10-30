/**
 * Módulo «Editores de VST» de JasWave (V4): en la web, el panel «Editor de plugin» muestra los VST de
 * JasWave con el mismo diseño que su editor nativo de escritorio. Paquete independiente: solo usa el DAW
 * a través de @jaswave/host-sdk y dibuja con @jaswave/ui-cyber.
 */

import { definirModulo, VERSION_SDK } from '@jaswave/host-sdk'
import { EditorVstWeb } from './editor-web'
import { layoutPorNombre } from './layouts'
import './estilos.css'

export default definirModulo({
  id: 'com.jaswave.modulo.editores-vst',
  nombre: 'Editores de VST',
  version: '1.0.0',
  sdk: VERSION_SDK,
  herramientas: [],
  activar: () => ({
    paneles: {},
    servicios: {
      editorPlugin: {
        soporta: (p) => layoutPorNombre(p.nombre) !== null,
        Componente: EditorVstWeb,
      },
    },
  }),
})
