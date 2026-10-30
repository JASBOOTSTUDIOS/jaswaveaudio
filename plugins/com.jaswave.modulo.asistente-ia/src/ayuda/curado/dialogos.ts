import type { FichaAyuda } from '@jaswave/host-sdk'

/**
 * Fichas curadas de los DIÁLOGOS y ventanas que no son paneles (`pantalla:*`), para principiantes.
 * Cada una sustituye a la ficha generada con el mismo id. Los textos de menú y los atajos salen de
 * `app-menu-bar.tsx`. Ningún control lleva `ayuda`: estos diálogos no tienen `data-testid`/`data-ayuda`
 * propios, así que se describen en los pasos.
 */
type Datos = Omit<FichaAyuda, 'tipo' | 'fuente' | 'id' | 'nivel'> & { nivel?: FichaAyuda['nivel'] }

const dialogo = (nombre: string, d: Datos): FichaAyuda => ({ id: `pantalla:${nombre}`, tipo: 'pantalla', nivel: 'principiante', fuente: 'curada', ...d })

export const fichasDialogos: FichaAyuda[] = [
  dialogo('nuevo-proyecto', {
    titulo: 'Nuevo proyecto',
    resumen:
      'Ventana para crear un proyecto: le das un nombre y eliges la carpeta donde se guardará todo (pistas, audio, ajustes). Un proyecto es como el cuaderno de una canción: sin guardarlo en una carpeta, perderías el trabajo al cerrar.',
    comoAbrir: { herramienta: 'dlg.nuevo-proyecto', menu: 'Archivo > Nuevo proyecto', atajo: 'Ctrl+N' },
    pasos: [
      'Crear un proyecto. 1) Abre Archivo > Nuevo proyecto (Ctrl+N). 2) Escribe el «Nombre del Proyecto» (por ejemplo «Worship Live 2026»). 3) En «Carpeta de Almacenamiento» pulsa «Examinar» y elige dónde guardarlo. 4) Revisa la «Ruta del Proyecto» que se muestra abajo y pulsa «Crear y Abrir Proyecto».',
      'Cuando se abre sola. Si intentas añadir una pista o importar audio y el proyecto aún no tiene nombre ni carpeta, la ventana aparece con un aviso. Rellénala y pulsa «Guardar y continuar»: se guarda el proyecto y sigue con lo que pedías.',
      'Cambiar de idea. «Cancelar» cierra la ventana sin crear nada.',
    ],
    relacionadas: ['pantalla:abrir-proyecto', 'panel:arrange', 'pantalla:ajustes-proyecto'],
    etiquetas: ['nuevo proyecto', 'crear proyecto', 'empezar', 'empezar una canción', 'nueva canción', 'proyecto nuevo', 'guardar proyecto', 'carpeta del proyecto', 'nombre del proyecto', 'primer paso'],
  }),

  dialogo('abrir-proyecto', {
    titulo: 'Abrir proyecto',
    resumen:
      'Sirve para continuar una canción que ya guardaste: eliges su archivo .jaswave y el DAW la carga con sus pistas, clips y ajustes. Si tienes cambios sin guardar en el proyecto actual, antes te pregunta qué hacer.',
    comoAbrir: { herramienta: 'dlg.abrir-proyecto', menu: 'Archivo > Abrir…', atajo: 'Ctrl+O' },
    pasos: [
      'Abrir un proyecto guardado. 1) Elige Archivo > Abrir… (Ctrl+O). 2) Selecciona el archivo .jaswave. 3) Si el proyecto actual tiene cambios sin guardar, elige entre guardar, descartar o cancelar. 4) Espera a que el host de plugins confirme los instrumentos antes de tocar.',
      'Abrir un proyecto empaquetado. Si alguien te pasó un .zip exportado con «Proyecto», usa Archivo > Abrir proyecto empaquetado (.zip)….',
      'Si un plugin da error al abrir. No significa que el proyecto esté dañado: ese VST aparece con aviso de error y el resto se carga igual.',
    ],
    relacionadas: ['pantalla:nuevo-proyecto', 'pantalla:exportar-bounce', 'panel:project-files'],
    etiquetas: ['abrir proyecto', 'abrir canción', 'cargar proyecto', 'continuar proyecto', 'proyecto guardado', 'archivo jaswave', 'abrir archivo', 'abrir zip', 'proyecto empaquetado', 'recuperar proyecto'],
  }),

  dialogo('ajustes-proyecto', {
    titulo: 'Ajustes del proyecto',
    resumen:
      'Atajo para abrir los ajustes del DAW (tempo, tonalidad, audio, MIDI, rutas, atajos, permisos de la IA). No es una ventana aparte: al abrirla te lleva al panel Configuración.',
    comoAbrir: { herramienta: 'dlg.ajustes-proyecto', menu: 'Acciones > Ajustes del proyecto…', atajo: 'Ctrl+8' },
    pasos: [
      'Abrir los ajustes. 1) Elige Acciones > Ajustes del proyecto…. 2) Se abre el panel Configuración con sus pestañas.',
      'Cambiar el tempo o la tonalidad. En la pestaña General edita BPM, Compás, Tónica y Modo.',
      'Arreglar «no se oye nada» o los cortes. En la pestaña Audio revisa el «Dispositivo de salida» y el «Buffer Size», y pulsa «Probar tono».',
      'Conectar el teclado. En la pestaña MIDI elige el «Controlador de entrada».',
    ],
    relacionadas: ['panel:settings', 'pantalla:atajos', 'pantalla:midi-map'],
    etiquetas: ['ajustes', 'ajustes del proyecto', 'configuración', 'preferencias', 'opciones', 'tempo', 'compás', 'tonalidad', 'audio', 'dispositivo', 'buffer', 'midi', 'no se oye'],
  }),

  dialogo('atajos', {
    titulo: 'Atajos de teclado',
    resumen:
      'Lista de todos los atajos del DAW (combinaciones de teclas que hacen una acción rápido) donde puedes buscarlos, cambiarlos o restaurarlos. Sirve para aprender los atajos y adaptarlos a tu forma de trabajar.',
    comoAbrir: { herramienta: 'dlg.atajos', menu: 'Ver > Atajos de teclado…', atajo: 'Ctrl+Shift+,' },
    pasos: [
      'Consultar un atajo. 1) Abre Ver > Atajos de teclado…. 2) Escribe en «Buscar atajo...» lo que haces (por ejemplo «metrónomo»). 3) Filtra por categoría (Transporte, Edición, Ventanas…) si quieres.',
      'Cambiar un atajo. 1) Haz clic en el atajo de la acción. 2) Cuando diga «Presiona teclas...», pulsa la nueva combinación (Esc cancela). 3) Si ya la usaba otra acción, el aviso «Conflicto» te lo dice y la reasigna.',
      'Volver a lo de fábrica. Usa «Restaurar atajo por defecto» en una fila o «Restaurar todo» para todos.',
    ],
    relacionadas: ['pantalla:paleta', 'panel:settings', 'pantalla:midi-map'],
    etiquetas: ['atajos', 'atajos de teclado', 'teclas', 'combinaciones de teclas', 'shortcuts', 'hotkeys', 'cambiar atajo', 'restaurar atajos', 'teclado'],
  }),

  dialogo('paleta', {
    titulo: 'Paleta de comandos',
    resumen:
      'Un buscador para ejecutar cualquier acción del DAW sin saber en qué menú está: escribes lo que quieres hacer («nueva pista», «metrónomo») y la eliges de la lista. Es la forma más rápida de encontrar algo cuando no sabes dónde está.',
    comoAbrir: { herramienta: 'dlg.paleta', menu: 'Ver > Paleta de comandos', atajo: 'Ctrl+Shift+P' },
    pasos: [
      'Ejecutar una acción por su nombre. 1) Pulsa Ctrl+Shift+P (o Ver > Paleta de comandos). 2) Escribe parte del nombre, por ejemplo «pista MIDI». 3) Muévete con las flechas arriba y abajo y pulsa Enter para ejecutarla.',
      'Cerrarla sin hacer nada. Pulsa Esc.',
      'Dictar en vez de escribir. El cuadro admite dictado por voz con Alt+V.',
    ],
    relacionadas: ['pantalla:atajos', 'panel:terminal', 'panel:coproducer'],
    etiquetas: ['paleta', 'paleta de comandos', 'buscar acción', 'buscador de comandos', 'command palette', 'ejecutar comando', 'no sé dónde está', 'buscar función', 'comandos'],
  }),

  dialogo('midi-map', {
    titulo: 'Control MIDI / MIDI Learn (ventana)',
    resumen:
      'Ventana flotante para asignar un control de tu teclado, mesa o pedal (tecla, perilla, fader, botón) a una función del DAW. Es la misma idea que el panel MIDI Learn, pero abierta como ventana desde el menú.',
    comoAbrir: { herramienta: 'dlg.midi-map', menu: 'Ver > Control MIDI / MIDI Learn…', atajo: 'Ctrl+Shift+M' },
    pasos: [
      'Asignar un control. 1) Abre Ver > Control MIDI / MIDI Learn…. 2) Busca la función con el cuadro «Buscar: sustain, volumen, play…». 3) Pulsa «Escuchar MIDI» en su fila y mueve el control (pedal, fader, tecla o botón). 4) La señal queda asignada y se muestra en la fila.',
      'Cancelar una asignación a medias. El botón pasa a «Cancelar» mientras espera señal.',
      'Quitar una asignación. Pulsa «Quitar» junto a la función; «Borrar mapas» elimina todas.',
    ],
    relacionadas: ['panel:midi-map', 'panel:midi-zones', 'panel:settings'],
    etiquetas: ['midi learn', 'control midi', 'asignar control', 'pedal', 'sustain', 'perillas', 'faders', 'teclado midi', 'mapear controles'],
  }),

  dialogo('exportar-bounce', {
    titulo: 'Exportar (canción, pistas, MIDI, proyecto)',
    resumen:
      'La ventana para sacar tu trabajo fuera del DAW: la canción terminada como archivo de audio, cada pista por separado (stems), un archivo MIDI o el proyecto completo empaquetado. «Bounce» significa convertir la mezcla en un archivo de audio.',
    comoAbrir: { herramienta: 'dlg.exportar-bounce', menu: 'Archivo > Exportar (canción, pistas, MIDI, proyecto)…', atajo: 'Ctrl+Alt+R' },
    pasos: [
      'Exportar la canción para escucharla o publicarla. 1) Guarda el proyecto (Ctrl+S) y revisa que no haya un Solo olvidado ni pistas silenciadas por error. 2) Abre Archivo > Exportar… y quédate en la pestaña «Canción». 3) Elige el «Formato» (WAV siempre disponible; para MP3, FLAC y otros se descarga el codificador una vez), «Profundidad» y «Frecuencia». 4) Deja «Duración» en Automática (llega hasta el final de la música y la cola de reverb). 5) Pulsa «Exportar» y elige dónde guardar el archivo.',
      'Ajustar el volumen final. En «Normalizar» elige «Pico −1 dB» o −14 LUFS (referencia típica de streaming). «Informe para» (Streaming, Club…) añade un informe de la medición.',
      'Sacar cada pista por separado. Pestaña «Pistas (stems)»: marca las pistas y elige si salen «Tras fader y paneo» o «Antes del fader»; se guardan en una carpeta «<nombre>-stems».',
      'Pasar la música a otro programa o compartir el proyecto. «MIDI» crea un archivo .mid con las notas; «Proyecto» crea un .zip con todo el audio, que se abre con Archivo > Abrir proyecto empaquetado.',
    ],
    relacionadas: ['panel:meters', 'panel:mixer', 'pantalla:exportar-partituras', 'pantalla:abrir-proyecto'],
    etiquetas: ['exportar', 'bounce', 'render', 'renderizar', 'mezcla final', 'guardar como wav', 'mp3', 'wav', 'stems', 'pistas por separado', 'exportar midi', 'sacar la canción', 'masterizar', 'archivo de audio', 'compartir canción'],
  }),

  dialogo('exportar-partituras', {
    titulo: 'Exportar partituras PDF',
    resumen:
      'Genera la partitura de tus clips MIDI como archivos PDF en una carpeta que elijas, uno por clip, para imprimirlos o dárselos a otro músico. Solo funciona en JasWave Desktop y necesita el módulo Partitura activo.',
    comoAbrir: { herramienta: 'dlg.exportar-partituras', menu: 'Archivo > Exportar partituras PDF…' },
    pasos: [
      'Exportar las partituras. 1) Comprueba que tu proyecto tiene clips MIDI con notas. 2) Elige Archivo > Exportar partituras PDF…. 3) Selecciona la carpeta de destino. 4) Los PDF quedan en una subcarpeta «scores» y al terminar aparece un aviso con el resultado.',
      'Llevar también el proyecto. La opción Archivo > Exportar proyecto + partituras… hace lo mismo y además copia el archivo .jaswave a esa carpeta.',
      'Revisar una sola partitura antes. Abre el panel Partitura y pulsa «Vista previa» o «PDF».',
    ],
    relacionadas: ['panel:score-editor', 'pantalla:exportar-bounce', 'panel:modulos'],
    etiquetas: ['partitura', 'partituras', 'pdf', 'imprimir partitura', 'exportar partitura', 'pentagrama', 'sacar partitura', 'notación'],
  }),
]
