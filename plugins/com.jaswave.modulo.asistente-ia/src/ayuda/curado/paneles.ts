import type { FichaAyuda } from '@jaswave/host-sdk'

/**
 * Fichas curadas de los PANELES (herramientas del workspace) para quien nunca ha usado un DAW.
 * Cada una sustituye a la ficha generada con el mismo id. Fuentes: el código de cada panel,
 * docs/manual-usuario/* y los textos reales del menú. Un control solo lleva `ayuda` si existe ese
 * `data-testid` en el código; el resto se describe en los pasos.
 */
type Datos = Omit<FichaAyuda, 'tipo' | 'fuente' | 'id' | 'nivel'> & { nivel?: FichaAyuda['nivel'] }

const panel = (nombre: string, d: Datos): FichaAyuda => ({ id: `panel:${nombre}`, tipo: 'panel', nivel: 'principiante', fuente: 'curada', ...d })

/** Todos los paneles se abren igual desde el menú; el rail izquierdo también los ofrece. */
const ver = (titulo: string) => `Ver > Herramientas > ${titulo}`

export const fichasPaneles: FichaAyuda[] = [
  panel('arrange', {
    titulo: 'Arrange (línea de tiempo)',
    resumen:
      'Es el tablero principal: ves todas las pistas una debajo de otra y los clips (trozos de audio o de notas) colocados en el tiempo. Aquí armas la estructura de la canción: qué suena, en qué pista y cuándo.',
    comoAbrir: { herramienta: 'arrange', menu: ver('Arrange') },
    pasos: [
      'Añadir una pista. 1) Pulsa el botón «+» (Añadir pista) arriba a la izquierda del Arrange. 2) Elige «Pista de Audio» (para grabar o importar sonido), «Pista MIDI» (para notas con un instrumento) o «Carpeta (bus)» (para agrupar pistas). También sirve el menú Acciones > Nueva pista de audio / Nueva pista MIDI. 3) Si el proyecto aún no tiene nombre ni carpeta, el DAW te pide ponérselos antes de crearla: así no pierdes el trabajo.',
      'Mover, recortar o cortar un clip. 1) Arrastra el cuerpo del clip para moverlo. 2) Arrastra su borde izquierdo o derecho para recortarlo. 3) Para dividirlo, coloca el cursor de reproducción donde quieras el corte, selecciona el clip y pulsa S (herramienta Dividir).',
      'Poner marcadores de sección (Intro, Estribillo…). 1) Coloca el cursor donde empieza la sección. 2) Pulsa el botón «Marcador» de la cabecera. 3) Haz doble clic sobre el marcador en la fila «Secciones» para ponerle nombre.',
      'Añadir acordes o letra. Acordes: doble clic en un hueco del carril «Acordes» y escribe el cifrado (por ejemplo Bm7). Letra: pulsa el botón «Letra» de la cabecera, pega el texto (una línea por frase) y aplícalo; se reparte por secciones o compases.',
    ],
    controles: [
      { ayuda: 'arrange-cabecera', etiqueta: 'Cabecera del Arrange', descripcion: 'Zona superior con el botón de añadir pista, marcadores, letra y las filas Secciones, Acordes y Letra.' },
      { ayuda: 'carril-marcadores', etiqueta: 'Fila «Secciones»', descripcion: 'Aparece cuando hay marcadores; doble clic renombra y arrastrar mueve.' },
      { ayuda: 'carril-acordes', etiqueta: 'Fila «Acordes»', descripcion: 'Insignias de acordes sobre la línea de tiempo.' },
      { ayuda: 'boton-pegar-letra', etiqueta: 'Botón «Letra»', descripcion: 'Abre el cuadro donde pegas la letra de la canción.' },
    ],
    relacionadas: ['panel:mixer', 'panel:piano-roll', 'panel:track-detail', 'pantalla:nuevo-proyecto'],
    etiquetas: ['línea de tiempo', 'timeline', 'pistas', 'pista', 'clips', 'secuenciador', 'arreglo', 'arreglos', 'estructura de la canción', 'marcadores', 'secciones', 'letra', 'acordes', 'cortar clip', 'mover clip', 'dividir', 'añadir pista', 'nueva pista'],
  }),

  panel('mixer', {
    titulo: 'Mixer (mezclador)',
    resumen:
      'El mezclador es una fila de «tiras», una por pista, más el Master (la salida final). En cada tira controlas el volumen con un fader, el reparto izquierda/derecha con el paneo y silencias o aíslas la pista. Sirve para que todo suene equilibrado.',
    comoAbrir: { herramienta: 'mixer', menu: ver('Mixer') },
    pasos: [
      'Equilibrar el volumen de las pistas. 1) Pulsa Play para escuchar la canción. 2) Sube o baja el fader (la barra vertical) de cada pista hasta que ninguna tape a las demás. 3) Vigila el medidor: si el pico llega a 0 dB se enciende «CLIP» en rojo (un clic lo reinicia); baja el volumen.',
      'Escuchar una pista sola o silenciarla. 1) En la tira de la pista pulsa «S» (Solo) para oír solo esa. 2) Pulsa «M» (Mute) para silenciarla. 3) Para volver a oír todo, apaga el Solo. Un Solo olvidado es la causa más común de «no se oye nada».',
      'Mover un sonido a la izquierda o a la derecha. Gira la perilla de Paneo de la tira; con doble clic vuelve al centro.',
      'Pedir una mezcla inicial automática. Pulsa «Automezcla» en la barra del mixer: ajusta volumen y paneo de forma automática. Se puede deshacer con Ctrl+Z.',
    ],
    controles: [
      { ayuda: 'mixer-strip-master', etiqueta: 'Tira Master', descripcion: 'El volumen general de toda la canción, al final de la fila.' },
      { ayuda: 'mixer-inserts-master', etiqueta: 'Efectos del Master', descripcion: 'Lista de efectos que procesan la mezcla completa (por ejemplo un limitador).' },
    ],
    relacionadas: ['panel:fx-chain', 'panel:meters', 'panel:routing', 'panel:track-detail'],
    etiquetas: ['mezclador', 'consola', 'faders', 'fader', 'volumen', 'paneo', 'pan', 'mute', 'solo', 'silenciar', 'master', 'mezcla', 'niveles', 'automezcla', 'envíos', 'sends', 'subir volumen', 'bajar volumen'],
  }),

  panel('piano-roll', {
    titulo: 'Piano roll (editor de notas)',
    resumen:
      'Muestra las notas de un clip MIDI como rectángulos sobre un teclado vertical: arriba son notas agudas, abajo graves, y de izquierda a derecha pasa el tiempo. Aquí escribes, corriges y humanizas melodías y acordes.',
    comoAbrir: { herramienta: 'piano-roll', menu: ver('Piano roll') },
    pasos: [
      'Abrir las notas de un clip. 1) Crea una pista MIDI y selecciona un clip MIDI en el Arrange (o usa «Abrir piano roll» en el Inspector). 2) Abre el panel Piano roll. Sin clip seleccionado verás el editor vacío: pulsa «Elegir clip MIDI…».',
      'Escribir notas a mano. 1) Elige la herramienta de dibujar (tecla D o B). 2) Haz clic en la rejilla a la altura de la nota que quieres, o arrastra para darle más duración. 3) Para borrar una nota, clic derecho sobre ella (o herramienta Borrar, tecla E).',
      'Que no suene robótico. 1) Selecciona las notas (o ninguna para todo el clip). 2) Cuantizar (tecla Q) las alinea a la rejilla, pero al 100 % suena rígido: baja la «Fuerza cuantización» a 50-75 %. 3) Varía la fuerza de cada nota en el carril de Velocidad (tecla G muestra u oculta el carril) arrastrando las barras.',
      'Elegir el tamaño del imán. En el selector «Profundidad de encaje» escoges a qué fracción de compás se pegan las notas al moverlas o dibujarlas.',
    ],
    relacionadas: ['panel:arrange', 'panel:track-detail', 'panel:midi-md', 'panel:score-editor', 'panel:instruments'],
    etiquetas: ['editor midi', 'notas', 'nota', 'teclado visual', 'cuantizar', 'cuantización', 'velocity', 'velocidad', 'humanizar', 'melodía', 'acordes', 'escribir notas', 'dibujar notas', 'editar notas', 'midi', 'rejilla', 'imán', 'snap'],
  }),

  panel('library', {
    titulo: 'Biblioteca (presets y estilos)',
    resumen:
      'Guarda tus ajustes favoritos de instrumentos y efectos (presets) y tus estilos de interpretación para reutilizarlos. Tiene pestañas Proyecto (solo este proyecto) y Global (para todos tus proyectos) y Estilos.',
    comoAbrir: { herramienta: 'library', menu: ver('Biblioteca') },
    pasos: [
      'Guardar un sonido que te gusta. 1) Carga un instrumento en una pista y ajústalo hasta que suene como quieres. 2) Selecciona esa pista y en la Biblioteca pulsa «Guardar». 3) Escribe un nombre para el preset cuando te lo pida.',
      'Reutilizarlo en otros proyectos. En la pestaña Proyecto, pulsa «Promover a global» en el preset; pasará a la pestaña Global.',
      'Buscar y aplicar. Escribe en el buscador (nombre, plugin, género…) y usa los botones de la fila del preset (por ejemplo «Probar» para oírlo antes de aplicarlo).',
      'Pasar presets entre equipos. Usa «Exportar JSON» e «Importar JSON».',
    ],
    relacionadas: ['panel:instruments', 'panel:fx-chain', 'panel:track-detail'],
    etiquetas: ['presets', 'preset', 'sonidos guardados', 'ajustes guardados', 'samples', 'estilos', 'favoritos', 'guardar sonido', 'cargar preset', 'banco de sonidos'],
  }),

  panel('track-detail', {
    titulo: 'Inspector (detalle de pista o clip)',
    resumen:
      'Muestra y deja cambiar las propiedades de lo que tengas seleccionado: una pista (nombre, volumen, paneo, color, entrada, plugins) o un clip (nombre, inicio, duración, color). Es la ficha técnica de la pista.',
    comoAbrir: { herramienta: 'track-detail', menu: ver('Inspector') },
    pasos: [
      'Cambiar nombre, color o icono de una pista. 1) Selecciona la pista en el Arrange. 2) En el Inspector edita «Nombre», «Color de pista» o «Icono». 3) El cambio se ve al instante en el Arrange y el Mixer.',
      'Elegir qué entra por la pista. En «Monitor / entrada» escoges la entrada de audio o MIDI y activas el monitor para oírte mientras tocas (es lo primero que hay que revisar antes de grabar).',
      'Añadir un instrumento o efecto. 1) En «Cadena de plugins» elige uno en «Añadir del catálogo». 2) Pulsa «Añadir». 3) Para verlos con más detalle, pulsa «Abrir FX Chain».',
      'Editar un clip. Selecciona el clip: aparecen «Nombre del clip», «Inicio (beats)» y «Duración», y el botón «Editar en piano roll» si es MIDI.',
    ],
    relacionadas: ['panel:fx-chain', 'panel:arrange', 'panel:mixer', 'panel:piano-roll'],
    etiquetas: ['propiedades', 'detalle de pista', 'ajustes de pista', 'entrada', 'monitor', 'nombre de pista', 'color de pista', 'freeze', 'congelar', 'inspector', 'clip', 'canal'],
  }),

  panel('meters', {
    titulo: 'Medidores (análisis de la mezcla)',
    resumen:
      'Te enseña con números y gráficos cómo suena la mezcla: espectro (graves, medios, agudos), campo estéreo, volumen general (LUFS) y picos. Sirve para comprobar que la canción no distorsiona y que tiene un volumen adecuado.',
    comoAbrir: { herramienta: 'meters', menu: ver('Medidores') },
    pasos: [
      'Ver cómo suena en vivo. 1) Abre Medidores y pulsa Play. 2) Mira «Espectro en vivo» y «Campo estéreo» mientras suena. 3) Si aparece «Clip», el pico pasó de −1 dBFS: baja el Master; hay un botón para reiniciar el indicador.',
      'Medir el volumen de la canción. Observa LUFS-M (momentáneo), LUFS-S (corto plazo) y LUFS-I (integrado, de toda la canción). Para streaming se suele apuntar a unos −14 LUFS (referencia del manual).',
      'Analizar una exportación. 1) Exporta la canción (Archivo > Exportar). 2) En Medidores pulsa «Analizar bounce»: verás el análisis del último bounce con bandas y el resultado Listen.',
      'Revisar problemas de rendimiento. La zona «Timing / buffer» indica si el motor de audio va justo; si da cortes, sube el buffer en Configuración > Audio.',
    ],
    relacionadas: ['panel:mixer', 'pantalla:exportar-bounce', 'panel:settings'],
    etiquetas: ['medidor', 'medidores', 'lufs', 'true peak', 'pico', 'clipping', 'saturación', 'espectro', 'analizador', 'volumen general', 'loudness', 'estéreo', 'nivel', 'vúmetro', 'vu'],
  }),

  panel('routing', {
    titulo: 'Ruteo (buses y envíos)',
    resumen:
      'Está pensado para gestionar buses y envíos (a dónde manda su sonido cada pista), pero en esta versión el panel solo muestra «Ruteo — próximamente». Los envíos ya se manejan desde el Mixer.',
    comoAbrir: { herramienta: 'routing', menu: ver('Ruteo') },
    pasos: [
      'Mandar varias pistas a un mismo efecto (por ejemplo una reverb común). 1) Pídele al Asistente Jas que cree un bus (el manual indica que puede hacerlo), o usa Acciones > Nueva carpeta (bus) si quieres agrupar pistas. 2) En el Mixer sube el control «Send» de cada pista hacia ese bus. 3) En el bus carga la reverb o el delay.',
      'Agrupar pistas para subirlas con un solo fader. Crea una «Carpeta (bus)» y arrastra las pistas dentro: su volumen, efectos, mute y solo se aplican a todo el grupo.',
    ],
    relacionadas: ['panel:mixer', 'panel:fx-chain'],
    etiquetas: ['buses', 'bus', 'envíos', 'envio', 'send', 'sends', 'retorno', 'routing', 'enrutamiento', 'rutear', 'reverb compartida', 'sidechain', 'subgrupo'],
  }),

  panel('instruments', {
    titulo: 'Instrumentos (catálogo de plugins)',
    resumen:
      'Lista los instrumentos y efectos instalados en tu equipo (plugins VST3). Un instrumento es lo que «convierte en sonido» las notas MIDI: sin uno cargado en la pista, el piano roll no suena.',
    comoAbrir: { herramienta: 'instruments', menu: ver('Instrumentos') },
    pasos: [
      'Ponerle un instrumento a una pista MIDI. 1) Crea o selecciona una pista MIDI en el Arrange. 2) En Instrumentos, localiza el plugin con el buscador («Buscar por nombre, vendor, ruta, rol…»). 3) Pulsa «Añadir a la pista seleccionada» en su fila. Ya suena con las notas del clip.',
      'Si no aparece ninguno. Abre Carpetas, añade la carpeta donde tienes tus VST3 y pulsa «Escanear carpetas».',
      'Usar un instrumento por rol. El botón «Insertar JasWave Roles» añade el instrumento que reparte batería, bajo, piano, etc. por rol, si está instalado.',
    ],
    relacionadas: ['panel:fx-chain', 'panel:plugin-editor', 'panel:track-detail', 'panel:library'],
    etiquetas: ['instrumento', 'plugins', 'plugin', 'vst', 'vst3', 'sintetizador', 'sonidos', 'catálogo', 'cargar instrumento', 'piano', 'batería', 'bajo', 'escanear', 'añadir instrumento', 'efectos'],
  }),

  panel('fx-chain', {
    titulo: 'FX Chain (cadena de efectos)',
    resumen:
      'La cadena de efectos de la pista seleccionada (o del Master): una lista de plugins por la que pasa el sonido, en orden, de arriba abajo. Sirve para dar forma al sonido: ecualizar, comprimir, añadir reverb.',
    comoAbrir: { herramienta: 'fx-chain', menu: ver('FX Chain') },
    pasos: [
      'Añadir un efecto. 1) Selecciona la pista en el Arrange. 2) En FX Chain abre el catálogo («Catálogo / carpetas…») y elige el plugin. 3) Se inserta al final de la cadena («Insert»).',
      'Cambiar el orden. Usa los botones «Subir» y «Bajar» de cada plugin. El orden importa: un orden típico es instrumento, ecualizador, compresor y reverb.',
      'Comparar con y sin efecto. Pulsa el botón de bypass del plugin para apagarlo sin quitarlo; vuelve a pulsarlo para reactivarlo.',
      'Retocar sus controles. Pulsa «Controles» (o abre el Editor de plugin) para mover sus parámetros. Con «Copiar cadena» y «Pegar cadena» pasas la cadena a otra pista.',
    ],
    relacionadas: ['panel:plugin-editor', 'panel:instruments', 'panel:mixer', 'panel:track-detail'],
    etiquetas: ['efectos', 'cadena de efectos', 'inserts', 'insertos', 'plugins', 'ecualizador', 'eq', 'compresor', 'reverb', 'delay', 'bypass', 'orden de efectos', 'añadir efecto'],
  }),

  panel('automation', {
    titulo: 'Automatización (curvas de volumen y paneo)',
    resumen:
      'Permite que el volumen o el paneo de una pista cambien solos a lo largo de la canción (por ejemplo, un fundido de entrada). Dibujas curvas en lugar de mover el fader a mano.',
    comoAbrir: { herramienta: 'automation', menu: ver('Automatización') },
    pasos: [
      'Hacer un fundido de entrada o de salida. 1) Selecciona la pista en el Arrange. 2) Abre Automatización. 3) Elige uno de los botones predefinidos: «Vol fade-in 8s» o «Vol fade-out 8s».',
      'Mover el sonido de izquierda a derecha. Usa el botón «Pan L→R 4s».',
      'Empezar de cero. «Limpiar» borra las curvas de esa pista. El panel trabaja sobre la pista seleccionada; si no hay ninguna, te lo pide.',
      'Grabar el movimiento de un fader. El manual describe activar «Write» en el modo de escritura, dar Play y mover el fader o el paneo para que se graben los puntos.',
    ],
    relacionadas: ['panel:mixer', 'panel:arrange', 'panel:track-detail'],
    etiquetas: ['automatizar', 'automatización', 'curvas', 'fade in', 'fade out', 'fundido', 'fundido de entrada', 'fundido de salida', 'subir poco a poco', 'write', 'movimiento del fader'],
  }),

  panel('plugin-editor', {
    titulo: 'Editor de plugin',
    resumen:
      'Es la ventana con los mandos del instrumento o efecto que tengas activo (perillas, selectores, teclados). Aquí cambias el sonido del plugin: tono, ataque, reverb, etc. En un VST de terceros abre su interfaz propia.',
    comoAbrir: { herramienta: 'plugin-editor', menu: ver('Editor de plugin') },
    pasos: [
      'Abrir los mandos de un plugin. 1) Selecciona la pista que lo tiene. 2) Abre el plugin desde el Inspector (botón «Abrir UI del plugin»), desde el catálogo de Instrumentos o desde su fila en la FX Chain. 3) Aparece aquí; los VST nativos pueden abrirse en una ventana flotante.',
      'Cambiar parámetros sin su interfaz. Pulsa «Controles»: parámetros, presets y herramientas del plugin.',
      'Volver a empezar. «Restablecer» devuelve todos los parámetros a sus valores por defecto (se puede deshacer). Si la ventana se cerró, «Reabrir».',
    ],
    relacionadas: ['panel:fx-chain', 'panel:instruments', 'panel:track-detail', 'panel:library'],
    etiquetas: ['editor de plugin', 'interfaz del plugin', 'perillas', 'mandos', 'parámetros', 'ajustar sonido', 'vst', 'ventana del plugin', 'abrir plugin', 'restablecer'],
  }),

  panel('midi-map', {
    titulo: 'MIDI Learn (asignar controles)',
    resumen:
      'Sirve para que un control físico de tu teclado o mesa (una tecla, perilla, fader o pedal) maneje una función del DAW, como el volumen, play o el pedal de sustain. Tú eliges la función y mueves el control; el DAW lo «aprende».',
    comoAbrir: { herramienta: 'midi-map', menu: ver('MIDI Learn'), atajo: 'Ctrl+Shift+M' },
    pasos: [
      'Asignar un control. 1) Conecta tu teclado o controlador. 2) Busca la función en el cuadro «Buscar: sustain, volumen, play…» (o filtra por grupo). 3) Pulsa «Escuchar MIDI» en su fila. 4) Mueve el control (pedal, fader, tecla o botón): su señal queda asignada y se muestra en la fila.',
      'Cancelar o quitar. Mientras esperas, el botón pasa a «Cancelar»; una función ya asignada tiene un botón «Quitar».',
      'Usar el mezclador M-VAVE SMC-MIXER. Ponlo en modo CC (User) y pulsa «Preset SMC-MIXER». «Borrar mapas» elimina todas las asignaciones.',
    ],
    relacionadas: ['pantalla:midi-map', 'panel:midi-zones', 'panel:settings'],
    etiquetas: ['midi learn', 'asignar control', 'controlador', 'pedal', 'sustain', 'perillas', 'faders físicos', 'teclado midi', 'mapear', 'asignar tecla', 'control midi'],
  }),

  panel('midi-zones', {
    titulo: 'Zonas MIDI (repartir el teclado)',
    resumen:
      'Para tocar en directo: divides tu teclado en zonas y cada zona toca una pista distinta (por ejemplo, graves para el bajo y agudos para el piano), o varias a la vez en capas. Cada zona puede transponer y cambiar la fuerza de las notas.',
    comoAbrir: { herramienta: 'midi-zones', menu: ver('Zonas MIDI') },
    pasos: [
      'Crear un split bajo / piano. 1) Ten dos pistas MIDI con su instrumento. 2) En Zonas MIDI pulsa «Añadir zona» y elige la «Pista destino». 3) Fija «Nota más grave» y «Nota más aguda» para que esa zona solo cubra ese rango (C4 = 60). 4) Repite con la otra pista.',
      'Hacer una capa (dos sonidos a la vez). Crea dos zonas con el mismo rango de notas y distinta pista.',
      'Transponer o suavizar. Por zona puedes poner «Transp.» (semitonos) y cambiar la velocidad.',
      'Apagar una zona sin borrarla. Pulsa su indicador ON/OFF; «Quitar zona» la elimina. Abajo hay un limitador true-peak del máster («Seguridad») por si en directo sube demasiado el volumen.',
    ],
    controles: [
      { ayuda: 'zona-anadir', etiqueta: 'Añadir zona', descripcion: 'Crea una zona nueva; requiere al menos una pista MIDI.' },
      { ayuda: 'zonas-teclado', etiqueta: 'Teclado de zonas', descripcion: 'Teclado visual que muestra qué rango cubre cada zona.' },
      { ayuda: 'zonas-seguridad', etiqueta: 'Seguridad del máster', descripcion: 'Limitador true-peak del máster con su techo en dBTP.' },
    ],
    relacionadas: ['panel:midi-map', 'panel:instruments', 'panel:arrange'],
    etiquetas: ['split', 'capas', 'layers', 'dividir el teclado', 'teclado dividido', 'tocar en directo', 'directo', 'en vivo', 'transponer', 'teclado midi', 'zonas', 'bajo y piano', 'rangos'],
  }),

  panel('grooves', {
    titulo: 'Grooves (ritmos de batería)',
    resumen:
      'Una biblioteca de ritmos de batería ya escritos en MIDI, organizados por estilo (pop, worship, etc.). Sirve para tener una base rítmica en segundos y luego editarla en el Piano roll como cualquier clip.',
    comoAbrir: { herramienta: 'grooves', menu: ver('Grooves') },
    pasos: [
      'Poner una batería a tu canción. 1) Crea una pista MIDI y cárgale una batería (por ejemplo Worship Drums). 2) Abre Grooves y busca por estilo en el cuadro «Buscar (estilo, nombre, etiqueta…)». 3) Pulsa el botón de escuchar de la fila para oír la vista previa. 4) Elige la pista en «Pista» y pulsa «Insertar».',
      'Colocarlo donde quieres. En la barra inferior elige cuántos «Compases» y pulsa «Insertar en el playhead» con el groove elegido: se coloca donde está el cursor de reproducción.',
      'Que no suene idéntico. Activa «Variación humana» y «Fill al final» (cambia el último compás por un redoble o adorno de cierre).',
      'Usar tus propios ritmos. Pulsa «Añadir groove…» e importa tus archivos .mid.',
    ],
    controles: [
      { ayuda: 'groove-buscar', etiqueta: 'Buscador', descripcion: 'Busca por estilo, nombre o etiqueta.' },
      { ayuda: 'groove-estilos', etiqueta: 'Columna de estilos', descripcion: 'Lista de estilos con el número de ritmos de cada uno.' },
      { ayuda: 'groove-lista', etiqueta: 'Lista de ritmos', descripcion: 'Cada fila tiene favorito, escuchar e Insertar.' },
      { ayuda: 'groove-previa', etiqueta: 'Escuchar', descripcion: 'Vista previa del ritmo.' },
      { ayuda: 'groove-insertar', etiqueta: 'Insertar', descripcion: 'Pone el ritmo en la pista elegida.' },
      { ayuda: 'groove-pista', etiqueta: 'Pista destino', descripcion: 'La pista MIDI donde se inserta el ritmo.' },
      { ayuda: 'groove-anadir', etiqueta: 'Añadir groove…', descripcion: 'Importa archivos .mid propios.' },
    ],
    relacionadas: ['panel:piano-roll', 'panel:instruments', 'panel:arrange'],
    etiquetas: ['ritmos', 'ritmo', 'batería', 'baterías', 'patrones de batería', 'drums', 'percusión', 'base rítmica', 'groove', 'estilo', 'worship', 'pop', 'fill', 'relleno', 'cuantizar'],
  }),

  panel('terminal', {
    titulo: 'Terminal (comandos del DAW)',
    resumen:
      'No es la terminal de Windows: es la línea de comandos de JasWave, donde escribes órdenes en español y ves el registro de lo que ejecuta la IA. Sirve para consultar el proyecto o controlarlo sin ratón.',
    comoAbrir: { herramienta: 'terminal', menu: 'Ver > Terminal', atajo: 'Ctrl+`' },
    pasos: [
      'Ver los comandos disponibles. Escribe «ayuda» y pulsa Enter.',
      'Consultar tu proyecto. Escribe «pistas» para listar las pistas o «estado» para un resumen; «listar» muestra el contenido de la carpeta virtual actual y «ir pistas» entra en ella.',
      'Controlar la reproducción. «reproducir», «pausar» y «detener»; «bpm 100» cambia el tempo.',
      'Limpiar la pantalla. «limpiar». Con «+» abres otra sesión de terminal.',
    ],
    relacionadas: ['panel:coproducer', 'panel:progress'],
    etiquetas: ['consola de comandos', 'línea de comandos', 'cli', 'comandos', 'escribir comandos', 'terminal', 'log de la ia', 'registro', 'ayuda'],
  }),

  panel('settings', {
    titulo: 'Configuración (ajustes del proyecto)',
    resumen:
      'El centro de ajustes del DAW: tempo y compás, tonalidad, dispositivo de audio, entrada MIDI, carpetas, atajos y permisos de la IA. Se organiza en pestañas (General, Audio, MIDI, Rutas, Atajos, Comandos, Permisos) más las páginas de los módulos.',
    comoAbrir: { herramienta: 'settings', menu: 'Acciones > Ajustes del proyecto…' },
    pasos: [
      'Cambiar tempo, compás o tonalidad. 1) Abre la pestaña General. 2) Edita BPM, Compás, Tónica y Modo. (El BPM también está en la barra de transporte.)',
      'Elegir la salida de sonido. 1) Pestaña Audio. 2) Elige «API / driver» y «Dispositivo de salida», y la frecuencia y el buffer. 3) «Probar tono» comprueba que sale sonido. Si no se oye nada o hay cortes, es aquí donde se corrige.',
      'Conectar tu teclado. 1) Pestaña MIDI. 2) Elige el «Controlador de entrada» y el canal. 3) «Cuantizar grabación» alinea lo que grabes a la rejilla (déjalo apagado para conservar tu toque).',
      'Ver y cambiar atajos o permisos de la IA. Pestaña Atajos y pestaña Permisos (nivel de autonomía de la IA).',
    ],
    relacionadas: ['pantalla:ajustes-proyecto', 'pantalla:atajos', 'panel:meters', 'panel:midi-map'],
    etiquetas: ['ajustes', 'configuración', 'preferencias', 'opciones', 'tempo', 'bpm', 'compás', 'tonalidad', 'tono', 'audio', 'dispositivo de audio', 'asio', 'buffer', 'latencia', 'no se oye', 'midi', 'rutas', 'permisos de la ia', 'sample rate'],
  }),

  panel('project-files', {
    titulo: 'Archivos (explorador del proyecto)',
    resumen:
      'Un explorador de carpetas como el de un editor de código: muestra los archivos de la carpeta de tu proyecto (stems, notas, recursos). Sirve para ver, crear y organizar lo que hay en disco.',
    comoAbrir: { herramienta: 'project-files', menu: ver('Archivos') },
    pasos: [
      'Ver los archivos de tu proyecto. Si dice «Ninguna carpeta abierta», pulsa «Abrir Carpeta» y elige la carpeta del proyecto.',
      'Crear algo nuevo. Usa los botones «Nuevo archivo» o «Nueva carpeta» de la barra superior.',
      'Actualizar la lista. Si copiaste archivos desde fuera, pulsa «Recargar árbol».',
    ],
    relacionadas: ['panel:docs-explorer', 'panel:library', 'pantalla:abrir-proyecto'],
    etiquetas: ['explorador', 'archivos', 'carpetas', 'ficheros', 'explorador de archivos', 'carpeta del proyecto', 'stems', 'recursos'],
  }),

  panel('cuenta', {
    titulo: 'Cuenta y licencia',
    resumen:
      'Aquí inicias sesión con tu cuenta de JasWave. La sesión activa la licencia de este equipo para los plugins JasWave y la colaboración en tiempo real. Sin sesión iniciada, esos plugins pueden no estar disponibles.',
    comoAbrir: { herramienta: 'cuenta', menu: ver('Cuenta') },
    pasos: [
      'Iniciar sesión. Abre Cuenta y rellena el formulario de acceso con tu correo y contraseña.',
      'Comprobar la licencia del equipo. En «Licencia de este equipo» ves si está activa; «Renovar» la renueva a mano (se mantiene renovada sola mientras haya sesión).',
      'Ver qué plugins tienes. Más abajo aparece el catálogo de plugins que tu cuenta tiene concedidos; si está vacío, pide acceso a un administrador.',
      'Cerrar sesión. Pulsa «Salir».',
    ],
    relacionadas: ['panel:admin', 'panel:modulos', 'panel:instruments'],
    etiquetas: ['cuenta', 'sesión', 'iniciar sesión', 'login', 'licencia', 'activar plugins', 'plugins bloqueados', 'colaboración', 'usuario', 'contraseña', 'cerrar sesión'],
  }),

  panel('admin', {
    titulo: 'Administración (JasWave Admin)',
    resumen:
      'Abre JasWave Admin, una aplicación aparte del DAW para gestionar cuentas y catálogos. Es solo para administradores: si no lo eres, no la necesitas.',
    comoAbrir: { menu: ver('Administración') },
    pasos: [
      'Abrir la app de administración. 1) Abre el panel Administración. 2) Pulsa «Abrir JasWave Admin». 3) Se abre en otra ventana; el acceso es solo para administradores.',
    ],
    relacionadas: ['panel:cuenta', 'panel:modulos'],
    etiquetas: ['administración', 'admin', 'administrador', 'jaswave admin', 'gestionar usuarios'],
  }),

  panel('modulos', {
    titulo: 'Módulos (extensiones opcionales)',
    resumen:
      'Los módulos son partes opcionales del DAW (asistente de IA, partitura, documentos, editores de VST…). Aquí los activas o desactivas, los instalas desde el catálogo o desde un archivo .jwx y ves cuáles tienes.',
    comoAbrir: { herramienta: 'modulos', menu: ver('Módulos') },
    pasos: [
      'Activar o desactivar un módulo. En la lista de módulos instalados, usa el interruptor «Activar» de cada uno.',
      'Instalar uno del catálogo. En la sección del catálogo pulsa «Instalar» (o «Actualizar» si ya lo tienes). «Recargar catálogo de módulos» refresca la lista.',
      'Instalar desde un archivo. Pulsa «Instalar desde archivo…» o arrastra un archivo .jwx a la ventana; se te mostrará qué contiene antes de instalarlo.',
      'Si falta un panel. Si abres una herramienta y dice que es de un módulo no instalado, pulsa «Abrir Módulos» y actívalo.',
    ],
    controles: [{ ayuda: 'panel-modulos', etiqueta: 'Panel Módulos', descripcion: 'Contenedor de la lista de módulos, el catálogo y las extensiones instaladas.' }],
    relacionadas: ['panel:coproducer', 'panel:score-editor', 'panel:docs', 'panel:midi-md'],
    etiquetas: ['módulos', 'extensiones', 'plugins del daw', 'activar módulo', 'instalar módulo', 'jwx', 'catálogo de módulos', 'complementos', 'add-ons'],
  }),

  panel('coproducer', {
    titulo: 'Asistente Jas (chat de IA)',
    resumen:
      'El copiloto del DAW: escribes lo que quieres en español («añade una batería», «explícame el mixer») y el asistente consulta el proyecto, responde dudas y, según el modo, hace los cambios con posibilidad de deshacer.',
    comoAbrir: { herramienta: 'coproducer', menu: ver('Asistente Jas') },
    pasos: [
      'Hacer una pregunta o pedir un cambio. 1) Escribe en el cuadro del chat, por ejemplo «¿cómo grabo con mi teclado?». 2) Envía el mensaje. 3) Si el pedido es ambiguo, te muestra preguntas con opciones.',
      'Elegir cómo actúa. Con el selector de modo: Consulta (solo responde, no cambia nada), Plan (prepara un plan para que tú lo apruebes), Crear (hace los cambios) o Auto (decide según lo que pidas).',
      'Deshacer lo que hizo. En modo Crear, cada respuesta ofrece deshacer sus cambios de una vez; también sirve Ctrl+Z.',
      'Ver los comandos. Escribe «/» en el chat para ver la lista; por ejemplo «/banda» produce un tema con la banda virtual.',
    ],
    relacionadas: ['panel:banda-virtual', 'panel:progress', 'panel:docs', 'panel:terminal'],
    etiquetas: ['asistente', 'jas', 'chat', 'ia', 'inteligencia artificial', 'copiloto', 'coproductor', 'pedir', 'preguntar', 'ayuda', 'modo consulta', 'modo plan', 'modo crear', 'componer con ia', 'comandos del chat'],
  }),

  panel('progress', {
    titulo: 'Progreso (plan y actividad de la IA)',
    resumen:
      'Resume el trabajo de la IA en tu proyecto: el plan con sus pasos, la actividad reciente, los cambios hechos y la evolución del volumen (LUFS). Sirve para saber qué se ha hecho y qué falta.',
    comoAbrir: { herramienta: 'progress', menu: ver('Progreso') },
    pasos: [
      'Ver el plan. En «Plan» aparecen los pasos pendientes y hechos. Si dice que aún no hay plan, pídele uno al asistente.',
      'Revisar qué ha hecho la IA. Mira «Actividad» y «Cambios en el proyecto» (puedes filtrar por especialista).',
      'Actualizar. Pulsa «Actualizar» para releer el estado.',
    ],
    relacionadas: ['panel:coproducer', 'panel:docs', 'panel:banda-virtual'],
    etiquetas: ['progreso', 'plan', 'bitácora', 'actividad', 'tareas', 'qué ha hecho la ia', 'cambios', 'historial de la ia', 'lufs en el tiempo'],
  }),

  panel('banda-virtual', {
    titulo: 'Banda virtual y «Mi estilo»',
    resumen:
      'Muestra a los agentes de la banda (batería, bajo, piano…) trabajando en vivo cuando produces un tema completo con la IA. Arriba incluye «Mi estilo»: aprende cómo tocas tú en el teclado para que la banda imite tu forma de tocar.',
    comoAbrir: { herramienta: 'banda-virtual', menu: ver('Banda virtual') },
    pasos: [
      'Producir una canción con la banda. En el chat del Asistente escribe «/banda» y tu idea (por ejemplo, «una balada worship en Re mayor»). Abre este panel para ver quién toca qué y las etapas.',
      'Enseñarle tu estilo. 1) Toca unos segundos con tu teclado MIDI. 2) En «Mi estilo» pulsa «Analizar mi toque». 3) Escribe un nombre y pulsa «Guardar como skill de estilo»: la banda lo usará en su próxima producción.',
      'Quitar un estilo guardado. Pulsa «Quitar» junto a su nombre en la lista.',
    ],
    controles: [
      { ayuda: 'banda-panel', etiqueta: 'Panel de la banda', descripcion: 'Contenedor con «Mi estilo» y la banda en vivo.' },
      { ayuda: 'mi-estilo-panel', etiqueta: 'Mi estilo', descripcion: 'Bloque que analiza cómo tocas y guarda tu estilo.' },
      { ayuda: 'mi-estilo-analizar', etiqueta: 'Analizar mi toque', descripcion: 'Mide tus últimos segundos de teclado.' },
      { ayuda: 'mi-estilo-nombre', etiqueta: 'Nombre del estilo', descripcion: 'Campo donde nombras el estilo antes de guardarlo.' },
      { ayuda: 'mi-estilo-guardar', etiqueta: 'Guardar como skill de estilo', descripcion: 'Guarda el estilo analizado para la banda.' },
    ],
    nivel: 'intermedio',
    relacionadas: ['panel:coproducer', 'panel:progress', 'panel:midi-zones'],
    etiquetas: ['banda', 'banda virtual', 'mi estilo', 'mi toque', 'aprender mi estilo', 'agentes', 'músicos virtuales', 'producir canción', 'tocar como yo', 'enseñar mi estilo', 'estilo de interpretación'],
  }),

  panel('docs', {
    titulo: 'Docs (plan.md y documentos)',
    resumen:
      'Editor de los documentos Markdown de tu proyecto, sobre todo el plan.md: la lista de pasos de la canción que el asistente puede ejecutar. Sirve para planificar con la IA y llevar el control de lo hecho.',
    comoAbrir: { herramienta: 'docs', menu: ver('Docs') },
    pasos: [
      'Abrir un documento. Abre el panel Explorador y haz clic en un archivo: se abre en una pestaña de Docs (si no hay ninguno, dice «Abre un archivo desde el Explorador»).',
      'Trabajar con un plan. 1) Añade pasos con «Añadir paso…» (o pídele al agente que planifique). 2) Pulsa «Aprobar plan» para que la IA pueda ejecutarlo. 3) Usa «Ejecutar» en un paso para pedir solo ese paso; marca «Hecho» u «Omitir» según avance.',
      'Comparar el plan con el proyecto. Pulsa «Evaluar» (Evaluar plan vs DAW).',
    ],
    relacionadas: ['panel:docs-explorer', 'panel:coproducer', 'panel:progress'],
    etiquetas: ['documentos', 'docs', 'plan.md', 'plan', 'markdown', 'notas', 'editor de texto', 'aprobar plan', 'tareas'],
  }),

  panel('docs-explorer', {
    titulo: 'Explorador de documentos',
    resumen:
      'Árbol de la carpeta docs/ de tu proyecto: aquí están el plan.md y los demás documentos. Sirve para elegir qué documento abrir o crear uno nuevo.',
    comoAbrir: { herramienta: 'docs-explorer', menu: ver('Explorador') },
    pasos: [
      'Abrir un documento. Haz clic en su nombre; usa «Abrir edición» para editarlo o «Abrir vista previa» para leerlo ya formateado.',
      'Crear uno nuevo. Pulsa «Nuevo .md» y ponle nombre.',
      'Refrescar o eliminar. «Recargar desde disco» vuelve a leer la carpeta; «Eliminar» quita el documento.',
    ],
    relacionadas: ['panel:docs', 'panel:project-files'],
    etiquetas: ['explorador', 'documentos', 'carpeta docs', 'archivos markdown', 'plan.md', 'nuevo documento'],
  }),

  panel('midi-md', {
    titulo: 'MIDI · MD (clip MIDI como tabla)',
    resumen:
      'Muestra un clip MIDI como una tabla de texto (Markdown) sincronizada con el Piano roll: si cambias una nota en uno, cambia en el otro. Es útil para revisar o editar notas con precisión, escribiendo números.',
    comoAbrir: { herramienta: 'midi-md', menu: ver('MIDI · MD') },
    nivel: 'intermedio',
    pasos: [
      'Vincular un clip. 1) Selecciona un clip MIDI en el Arrange. 2) Abre MIDI · MD y pulsa «Vincular clip» (o clic derecho en el clip > Abrir MIDI · MD). 3) Verás su tabla de notas con la sincronización activa.',
      'Editar desde la tabla. Cambia el valor de una nota; si el formato es válido, el clip y el Piano roll se actualizan. Si está mal formado, aparece un aviso y no se toca el MIDI.',
      'Dejar de sincronizar. Pulsa «Desvincular sync».',
    ],
    relacionadas: ['panel:piano-roll', 'panel:docs', 'panel:arrange'],
    etiquetas: ['midi markdown', 'clip como texto', 'tabla de notas', 'editar notas en texto', 'markdown', 'sincronizar piano roll', 'notas numéricas'],
  }),

  panel('score-editor', {
    titulo: 'Partitura',
    resumen:
      'Convierte un clip MIDI en partitura (notas en pentagrama), sincronizada con el clip. Sirve para leer lo que tocas, imprimirlo o pasarlo a PDF.',
    comoAbrir: { herramienta: 'score-editor', menu: ver('Partitura') },
    pasos: [
      'Ver un clip como partitura. 1) Selecciona un clip MIDI en el Arrange. 2) Abre Partitura. 3) Si no lo toma solo, pulsa «Elegir clip MIDI…».',
      'Mirar en grande. Pulsa «Vista previa» para abrirla ampliada (con zoom).',
      'Sacar un PDF. Pulsa «PDF» en el panel. Para exportar todas las partituras del proyecto usa Archivo > Exportar partituras PDF….',
      'Corregir notas. El botón «Piano roll» te lleva al editor de notas del mismo clip.',
    ],
    relacionadas: ['panel:piano-roll', 'pantalla:exportar-partituras', 'panel:midi-md'],
    etiquetas: ['partitura', 'pentagrama', 'solfeo', 'leer música', 'imprimir', 'pdf', 'notación', 'partituras', 'score'],
  }),
]
