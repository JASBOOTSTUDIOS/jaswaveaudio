/**
 * Registro de capacidades del sistema y características disponibles.
 *
 * Propósito:
 *   Determinar en tiempo de ejecución qué funcionalidades están activas
 *   según la licencia, hardware detectado y configuración del usuario.
 *
 * Importancia:
 *   - Permite deshabilitar/habilitar UI y módulos sin compilación condicional.
 *   - Sirve como fuente de verdad para la IA y el sistema de plugins,
 *     evitando ofrecer herramientas no disponibles.
 *   - Facilita la validación de permisos y la personalización por perfil.
 *
 * Función:
 *   Exporta CapabilityRegistry, CapabilityDescriptor y constantes
 *   de capacidades conocidas del DAW, incluyendo fechas de expiración
 *   y versiones de características.
 */

export interface CapabilityDescriptor {
  id: string;
  nombre: string;
  descripcion: string;
  categoria: string;
  activa: boolean;
  razonInactiva?: string;
  version?: string;
  fechaExpiracion?: number;
}

export interface CapabilityRegistry {
  capacidades: CapabilityDescriptor[];
  licenciaTipo: 'gratuita' | 'personal' | 'profesional' | 'enterprise';
  licenciaExpiracion: number | null;
  hardwareConectado: string[];
  pluginsDisponibles: string[];
  usuarioId?: string;
  organizacionId?: string;
}

export const CapacidadesConocidas = {
  multipista: 'cap.multipista',
  automatizacion: 'cap.automatizacion',
  grabacion: 'cap.grabacion',
  exportacionStems: 'cap.exportacion.stems',
  sincronizacionNube: 'cap.nube',
  iaAsistente: 'cap.ia',
  notacion: 'cap.notacion',
  escenas: 'cap.escenas',
  vca: 'cap.vca',
  sidechain: 'cap.sidechain',
  controlMIDI: 'cap.midi',
  superficieControl: 'cap.superficie',
  video: 'cap.video',
  dvd: 'cap.dvd',
  surround: 'cap.surround',
  dolbyAtmos: 'cap.dolby.atmos',
  dts: 'cap.dts',
  aRA: 'cap.ara',
  oversampling: 'cap.oversampling',
  timeStretch: 'cap.timeStretch',
  pitchShift: 'cap.pitchShift',
  convolution: 'cap.convolution',
  script: 'cap.script',
  scripting: 'cap.scripting',
  apiExterna: 'cap.api.externa',
} as const;
