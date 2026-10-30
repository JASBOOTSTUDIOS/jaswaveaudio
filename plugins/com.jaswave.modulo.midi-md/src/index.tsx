/**
 * Módulo «MIDI · Markdown» de JasWave: un clip MIDI como documento .md (tabla de notas) sincronizado en
 * vivo con el piano roll. Paquete independiente: solo usa el DAW a través de @jaswave/host-sdk.
 */

import { FileCode2 } from 'lucide-react'
import { definirModulo, getSharedStore, requestOpenTool, VERSION_SDK } from '@jaswave/host-sdk'
import { MidiClipMdPanel } from './panel'
import { openMidiClipMdSync, unbindMidiClipMdSync } from './sync'
import './estilos.css'

export default definirModulo({
  id: 'com.jaswave.modulo.midi-md',
  nombre: 'MIDI · Markdown',
  version: '1.0.0',
  sdk: VERSION_SDK,
  herramientas: [
    {
      id: 'midi-md',
      titulo: 'MIDI · MD',
      descripcion: 'Clip MIDI como .md con sync en vivo al piano roll',
      zona: 'left',
      icono: FileCode2,
      bajoDemanda: true,
    },
  ],
  activar: () => ({
    paneles: { 'midi-md': MidiClipMdPanel },
    menus: {
      clip: [
        {
          id: 'midi-md.abrir',
          etiqueta: 'Abrir MIDI · MD',
          icono: FileCode2,
          visible: (c) => c.tipo === 'midi',
          ejecutar: (c) => {
            openMidiClipMdSync(getSharedStore(), c.clipId, c.trackId)
            requestOpenTool('midi-md', { zone: 'left' })
          },
        },
      ],
    },
    desactivar: () => unbindMidiClipMdSync(),
  }),
})
