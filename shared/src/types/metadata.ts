/**
 * Metadatos del proyecto del DAW.
 *
 * Propósito:
 *   Almacenar información descriptiva y administrativa del proyecto,
 *   separada de los datos de audio y configuración técnica.
 *
 * Importancia:
 *   - Permite catalogar y buscar proyectos por autor, género, tags.
 *   - Facilita la exportación de información para publicación y
 *     distribución musical.
 *   - Sirve como fuente de contexto para la IA al analizar el proyecto.
 *
 * Función:
 *   Exporta ProjectMetadata con campos de autor, género, tags, notas,
 *   copyright, isrc y fechas de creación/modificación.
 */

export interface ProjectMetadata {
  autor: string;
  genero: string;
  tags: string[];
  notas: string;
  copyright: string;
  isrc?: string;
  iswc?: string;
  fechaCreacion: number;
  fechaModificacion: number;
  version: number;
  readOnly: boolean;
  customData: Record<string, unknown>;
  keyBindings?: import('./command').KeyBinding[];
}
