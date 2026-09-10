/**
 * Estado de la interfaz de usuario del DAW.
 *
 * Propósito:
 *   Modelar todo el estado transitorio de la UI sin mezclarlo con los
 *   datos del proyecto, cumpliendo con la separación UI/Proyecto.
 *
 * Importancia:
 *   - Aísla la UI del estado del proyecto, evitando que cambios visuales
 *     contaminen el modelo de dominio o generen entradas de undo/redo.
 *   - Permite reconstruir la disposición de paneles al restaurar sesiones
 *     o al cambiar de tema.
 *   - Facilita el tipado de eventos UI y comandos de navegación.
 *
 * Función:
 *   Exporta UIState, PanelLayout, PanelPosicion, vistas de barra lateral/paneles
 *   inferior/derecho, junto con posiciones de scroll, zoom, foco,
 *   herramienta activa, modo de edición y estado de carga.
 */

import type { ValorJSON } from '../events/evento-dominio';

export type VistasBarraLateral = 'explorador' | 'buscar' | 'control-origen' | 'extensiones';
export type VistasPanelInferior = 'terminal' | 'chat' | 'problemas' | 'salida';
export type VistasPanelDerecho = 'propiedades' | 'extensiones-mercado';
export type Tema = 'claro' | 'oscuro' | 'sistema';
export type IdPanel = 'barra-lateral' | 'inferior' | 'derecho' | 'editor';
export type HerramientaActiva = 'select' | 'pencil' | 'eraser' | 'split' | 'glue' | 'mute' | 'solo' | 'record' | 'fade' | 'zoom' | 'hand' | 'marker' | 'snap' | 'move';
export type ModoEdicion = 'arrange' | 'edit' | 'paint' | 'automation' | 'mix';
export type TipoVistaEditor = 'inicio' | 'chat' | 'daw' | 'configuracion' | 'extensiones' | 'audio';
export type OrigenMenuContextual = 'pista' | 'clip' | 'editor' | 'mixer' | 'barraEstado' | 'barraLateral' | 'panelInferior' | 'panelDerecho' | 'lineaTiempo' | 'transport';
export type TipoArrastre = 'clip' | 'pista' | 'plugin' | 'archivo' | 'puntoAutomatizacion' | 'panel' | 'fade' | 'marcador' | 'region' | 'medio' | 'color' | 'tag';
export type DensidadIconos = 'compacto' | 'normal' | 'amplio';

export interface PanelLayout {
  anchoBarraLateral: number;
  altoPanelInferior: number;
  anchoPanelDerecho: number;
  barraLateralVisible: boolean;
  panelInferiorVisible: boolean;
  panelDerechoVisible: boolean;
}

export interface PanelPosicion {
  id: string;
  tipo: 'ventana' | 'acoplado';
  x: number;
  y: number;
  ancho: number;
  alto: number;
  maximizado: boolean;
}

/**
 * Pestaña del área de editor del DAW.
 *
 * Propósito:
 *   Representar una pestaña abierta en el área de editor principal,
 *   permitiendo múltiples vistas simultáneas (proyecto, chat, DAW,
 *   configuración, extensiones, audio).
 *
 * Importancia:
 *   - Centraliza el estado de navegación entre vistas del editor.
 *   - Soporta detección de cambios no guardados por pestaña.
 *   - Facilita la restauración de sesiones y el historial de navegación.
 *
 * Función:
 *   Define el contrato para pestañas con id, título, tipo, estado
 *   de modificación y datos opcionales específicos de la vista.
 */
export interface PestanaEditor {
  id: string;
  titulo: string;
  tipo: TipoVistaEditor;
  datos?: ValorJSON;
  modificado: boolean;
  icono?: string;
  orden: number;
}

/**
 * Configuración visual de la cuadrícula de la línea de tiempo.
 *
 * Propósito:
 *   Controlar la apariencia y comportamiento de snap de la cuadrícula
 *   del timeline sin mezclarlo con el estado de proyecto.
 *
 * Importancia:
 *   - Permite ajustes de usabilidad sin alterar el modelo de dominio.
 *   - Soporta temas claros/oscuros con colores personalizados.
 *   - Aísla la presentación de la lógica de snap del transporte.
 *
 * Función:
 *   Exporta ConfiguracionCuadricula con tipo, snap, colores y grosores.
 */
export interface ConfiguracionCuadricula {
  tipo: 'compas' | 'beat' | 'subdivision';
  subdivision: number;
  activa: boolean;
  snap: boolean;
  colorLineaPrincipal: string;
  colorLineaSecundaria: string;
  grosorLineaPrincipal: number;
  grosorLineaSecundaria: number;
}

/**
 * Área visible calculada de la línea de tiempo.
 *
 * Propósito:
 *   Proveer la ventana de visualización actual del timeline para
 *   optimizar el renderizado y calcular posiciones visibles.
 *
 * Importancia:
 *   - Evita renderizar clips fuera de viewport.
 *   - Permite lazy-loading de waveforms y metadatos.
 *   - Centraliza cálculos de compases visibles.
 *
 * Función:
 *   Exporta ViewportLineaTiempo con rangos de tiempo, pistas visibles
 *   y dimensiones en píxeles.
 */
export interface ViewportLineaTiempo {
  tiempoInicio: number;
  tiempoFin: number;
  anchoVisible: number;
  altoVisible: number;
  pistasVisibles: string[];
  compasInicio: number;
  compasFin: number;
}

/**
 * Estado detallado de arrastre de elementos en la UI.
 *
 * Propósito:
 *   Modelar el estado transitorio de operaciones drag-and-drop
 *   sobre clips, pistas, plugins, archivos y paneles.
 *
 * Importancia:
 *   - Evita usar booleanos planos para diferenciar tipos de arrastre.
 *   - Soporta feedback visual y snap durante el arrastre.
 *   - Permite cancelar y persistir operaciones complejas.
 *
 * Función:
 *   Exporta EstadoArrastre con origen, tipo, entidad, desplazamientos
 *   y datos de transferencia opcionales.
 */
export interface EstadoArrastre {
  activo: boolean;
  origen: IdPanel;
  tipo: TipoArrastre;
  entidadId?: string;
  pistaId?: string;
  desplazamientoX: number;
  desplazamientoY: number;
  posicionActualX: number;
  posicionActualY: number;
  datosTransferencia?: ValorJSON;
}

/**
 * Estado del menú contextual de la UI.
 *
 * Propósito:
 *   Controlar la apertura, posición y origen de menús contextuales
 *   en cualquier región del DAW.
 *
 * Importancia:
 *   - Centraliza el estado de menus flotantes.
 *   - Soporta diferentes conjuntos de acciones por origen.
 *   - Facilita cierre por click fuera o navegación con teclado.
 *
 * Función:
 *   Exporta EstadoMenuContextual con posición, origen y entidades
 *   asociadas.
 */
export interface EstadoMenuContextual {
  abierto: boolean;
  x: number;
  y: number;
  origen: OrigenMenuContextual;
  entidadesIds: string[];
}

/**
 * Estado detallado de la paleta de comandos.
 *
 * Propósito:
 *   Modelar la paleta de comandos (command palette) con filtrado,
 *   selección por teclado y resultados dinámicos.
 *
 * Importancia:
 *   - Mejora la accesibilidad y velocidad de navegación.
 *   - Centraliza el estado sin mezclarlo con la lógica de búsqueda.
 *   - Soporta categorías, atajos y priorización de comandos.
 *
 * Función:
 *   Exporta EstadoPaletaComandos con filtro, índice, comandos
 *   filtrados y estado de apertura.
 */
export interface EstadoPaletaComandos {
  abierta: boolean;
  filtro: string;
  indiceSeleccionado: number;
  comandosFiltrados: Array<{
    id: string;
    etiqueta: string;
    categoria: string;
    atajo?: string;
  }>;
}

/**
 * Estado de interacción específico de la línea de tiempo.
 *
 * Propósito:
 *   Modelar el estado transitorio de la UI del timeline: hover,
 *   selección rectangular, cursor y drops externos.
 *
 * Importancia:
 *   - Aísla la interacción temporal del estado de dominio.
 *   - Soporta feedback visual inmediato sin mutar estado global.
 *   - Facilita la renderización condicional de guías y snap.
 *
 * Función:
 *   Exporta EstadoLineaTiempoUI con arrastre, hover, selección
 *   rectangular y posición del cursor.
 */
export interface EstadoLineaTiempoUI {
  arrastrando: EstadoArrastre | null;
  sobrePistaId: string | null;
  sobreClipId: string | null;
  hayDropExterno: boolean;
  seleccionRectangulo: {
    activo: boolean;
    x: number;
    y: number;
    ancho: number;
    alto: number;
  } | null;
  cursorX: number;
  cursorY: number;
}

/**
 * Estado del área de editor DAW (workspace).
 *
 * Propósito:
 *   Modelar el estado del área de trabajo principal cuando se encuentra
 *   en vista DAW: timeline, mixer, splitter y selección de clip.
 *
 * Importancia:
 *   - Centraliza la disposición interna del workspace DAW.
 *   - Permite reconstruir el layout al cambiar de vista o tema.
 *   - Aísla el estado de paneles internos de la configuración global.
 *
 * Función:
 *   Exporta EstadoEditorDAW con selección, alturas, splitter y
 *   estado de dragging.
 */
export interface EstadoEditorDAW {
  clipSeleccionadoId: string | null;
  alturaTimeline: number;
  splitterDragging: boolean;
  splitterPosicion: number;
}

/**
 * Estado de la barra de estado inferior.
 *
 * Propósito:
 *   Controlar la información mostrada en la barra de estado:
 *   rama de control de versiones, mensajes, sincronización y usuario.
 *
 * Importancia:
 *   - Provee feedback inmediato del sistema y proyecto.
 *   - Centraliza información dispersa en un solo lugar.
 *   - Facilita la internacionalización y formateo.
 *
 * Función:
 *   Exporta EstadoBarraEstado con rama, mensajes, errores y
 *   estado de sincronización.
 */
export interface EstadoBarraEstado {
  ramaActual: string;
  mensajeIzquierdo: string;
  mensajeDerecho: string;
  advertencias: number;
  errores: number;
  sincronizado: boolean;
  dispositivoId: string;
  usuarioId?: string;
}

/**
 * Estado visual del mezclador en la UI.
 *
 * Propósito:
 *   Modelar el estado transitorio del mezclador sin mezclarlo con
 *   los datos de dominio de ChannelStrip.
 *
 * Importancia:
 *   - Aísla la presentación de la lógica de mezcla.
 *   - Soporta selección visual de canales y scroll.
 *   - Permite vistas personalizadas (solo canales seleccionados).
 *
 * Función:
 *   Exporta EstadoMezcladorUI con canales visibles, niveles y
 *   estado de selección.
 */
export interface EstadoMezcladorUI {
  canalesVisibles: string[];
  nivelMaster: number;
  seleccionando: boolean;
  seleccionInicio: number;
  seleccionFin: number;
  colapsado?: boolean;
}

/**
 * Configuración visual general de la UI.
 *
 * Propósito:
 *   Ajustar la densidad, tipografía y animaciones de la interfaz
 *   sin afectar el estado del proyecto.
 *
 * Importancia:
 *   - Mejora la accesibilidad y comodidad del usuario.
 *   - Centraliza preferencias visuales en un solo lugar.
 *   - Permite temas personalizados sin cambiar el modelo.
 *
 * Función:
 *   Exporta ConfiguracionVisualUI con densidad, tamaño de fuente,
 *   animaciones y transparencias.
 */
export interface ConfiguracionVisualUI {
  densidadIconos: DensidadIconos;
  tamanoFuente: number;
  mostrarMinimapa: boolean;
  animaciones: boolean;
  transparenciaPanel: number;
}

/**
 * Configuración de accesibilidad de la UI.
 *
 * Propósito:
 *   Ajustar opciones de accesibilidad sin mezclarlas con el
 *   estado del proyecto o transporte.
 *
 * Importancia:
 *   - Garantiza usabilidad para usuarios con necesidades especiales.
 *   - Centraliza banderas de accesibilidad.
 *   - Facilita el cumplimiento de estándares WCAG.
 *
 * Función:
 *   Exporta ConfiguracionAccesibilidadUI con contraste, lector de
 *   pantalla, navegación por teclado y animaciones reducidas.
 */
export interface ConfiguracionAccesibilidadUI {
  contrasteAlto: boolean;
  lectorPantalla: boolean;
  navegacionTeclado: boolean;
  tamanioFuenteMinimo: number;
  animacionesReducidas: boolean;
}

/**
 * Estado detallado de carga de la UI.
 *
 * Propósito:
 *   Reemplazar el número simple de progreso por un estado detallado
 *   que soporta múltiples cargas concurrentes.
 *
 * Importancia:
 *   - Evita parpadeos y conflictos entre cargas simultáneas.
 *   - Permite cancelar cargas individuales.
 *   - Provee feedback preciso al usuario.
 *
 * Función:
 *   Exporta EstadoCargaDetallado con progreso global y lista de
 *   cargas activas.
 */
export interface EstadoCargaDetallado {
  progresoGlobal: number;
  cargasActivas: Array<{
    id: string;
    etiqueta: string;
    progreso: number;
    cancelable: boolean;
  }>;
}

/**
 * Payload del evento ui.panelAbierto.
 */
export interface EventoUIPanelAbiertoPayload {
  panelId: IdPanel;
  titulo?: string;
}

/**
 * Payload del evento ui.panelCerrado.
 */
export interface EventoUIPanelCerradoPayload {
  panelId: IdPanel;
}

/**
 * Payload del evento ui.zoomCambiado.
 */
export interface EventoUIZoomCambiadoPayload {
  zoomHorizontal: number;
  zoomVertical: number;
  origen: IdPanel;
}

/**
 * Payload del evento ui.scrollCambiado.
 */
export interface EventoUIScrollCambiadoPayload {
  scrollX: number;
  scrollY: number;
  panel: IdPanel;
}

/**
 * Payload del evento ui.focoCambiado.
 */
export interface EventoUIFocoCambiadoPayload {
  focoAnterior: IdPanel | null;
  focoNuevo: IdPanel | null;
}

/**
 * Payload del evento ui.arrastrandoIniciado y ui.arrastrandoFinalizado.
 */
export interface EventoUIArrastrandoPayload {
  activo: boolean;
  tipo: TipoArrastre;
  origen: IdPanel;
}

/**
 * Payload del evento ui.dialogoAbierto y ui.dialogoCerrado.
 */
export interface EventoUIDialogoPayload {
  dialogoId: string;
  datos?: ValorJSON;
}

/**
 * Payload del evento ui.menuAbierto y ui.menuCerrado.
 */
export interface EventoUIMenuPayload {
  origen: OrigenMenuContextual;
  entidadesIds: string[];
}

/**
 * Payload del evento ui.tooltipMostrado y ui.tooltipOculto.
 */
export interface EventoUITooltipPayload {
  texto: string;
  x: number;
  y: number;
}

/**
 * Payload del evento ui.cargaIniciada y ui.cargaFinalizada.
 */
export interface EventoUICargaPayload {
  id: string;
  etiqueta: string;
  progreso: number;
}

export interface UIState {
  tema: Tema;
  idioma: string;
  vistaSidebar: VistasBarraLateral;
  vistaPanelInferior: VistasPanelInferior;
  vistaPanelDerecho: VistasPanelDerecho;
  layout: PanelLayout;
  playheadVisible: boolean;
  /** Magnético: anclar playhead a la rejilla visible (transporte). Default true. */
  playheadSnap?: boolean;
  scrollX: number;
  scrollY: number;
  zoomHorizontal: number;
  zoomVertical: number;
  panelActivo: IdPanel | null;
  paletaComandosAbierta: boolean;
  dialogoActivo: string | null;
  dialogoPayload?: Record<string, unknown>;
  arrastrando: boolean;
  cargaProgreso: number;
  etiquetaEstado: string;
  tooltip: { texto: string; x: number; y: number } | null;
  herramientaActiva: HerramientaActiva;
  modoEdicion: ModoEdicion;
  panelesDesacoplados: PanelPosicion[];
  panelMinimizados: string[];
  atajosPersonalizados: Record<string, string>;
  busquedaAbierta: boolean;
  busquedaTexto: string;
  ultimoFoco: IdPanel | null;
  pestanas?: PestanaEditor[];
  pestanaActivaId?: string;
  configuracionCuadricula?: ConfiguracionCuadricula;
  viewport?: ViewportLineaTiempo;
  estadoArrastre?: EstadoArrastre | null;
  estadoMenuContextual?: EstadoMenuContextual;
  estadoPaletaComandos?: EstadoPaletaComandos;
  estadoLineaTiempoUI?: EstadoLineaTiempoUI;
  estadoEditorDAW?: EstadoEditorDAW;
  estadoBarraEstado?: EstadoBarraEstado;
  estadoMezcladorUI?: EstadoMezcladorUI;
  configuracionVisual?: ConfiguracionVisualUI;
  configuracionAccesibilidad?: ConfiguracionAccesibilidadUI;
  estadoCargaDetallado?: EstadoCargaDetallado;
  puedeDeshacer?: boolean;
  puedeRehacer?: boolean;
  expandidoCarpetas?: string[];
}

export function esModoArrange(estado: UIState): boolean {
  return estado.modoEdicion === 'arrange';
}

export function esModoEdit(estado: UIState): boolean {
  return estado.modoEdicion === 'edit';
}

export function esModoPaint(estado: UIState): boolean {
  return estado.modoEdicion === 'paint';
}

export function esModoAutomation(estado: UIState): boolean {
  return estado.modoEdicion === 'automation';
}

export function esModoMix(estado: UIState): boolean {
  return estado.modoEdicion === 'mix';
}

export function esPanelActivo(estado: UIState, idPanel: IdPanel): boolean {
  return estado.panelActivo === idPanel;
}

export function obtenerPestanaActiva(estado: UIState): PestanaEditor | undefined {
  if (!estado.pestanas || !estado.pestanaActivaId) return undefined;
  return estado.pestanas.find(p => p.id === estado.pestanaActivaId);
}

export function esCargaActiva(estado: UIState): boolean {
  if (!estado.estadoCargaDetallado) return estado.cargaProgreso > 0 && estado.cargaProgreso < 100;
  return estado.estadoCargaDetallado.cargasActivas.length > 0;
}

export function estaPaletaAbierta(estado: UIState): boolean {
  return estado.paletaComandosAbierta || (estado.estadoPaletaComandos?.abierta ?? false);
}

export function estaArrastrando(estado: UIState): boolean {
  return estado.arrastrando || (estado.estadoArrastre?.activo ?? false);
}
