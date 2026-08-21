/**
 * Catálogo legacy de atajos — generado desde Action Catalog canónico.
 */

import { getActionCatalog, buildLegacyAtajoMap, buildDefaultKeymap } from '../actions';

export interface AccionAtajo {
  id: string;
  descripcion: string;
  categoria: 'global' | 'daw' | 'edicion' | 'transporte' | 'proyecto' | 'ventana' | 'ui';
  comandoPorDefecto: string;
  cuando?: (estado: unknown) => boolean;
}

const CATEGORY_MAP: Record<string, AccionAtajo['categoria']> = {
  Transport: 'transporte',
  Project: 'proyecto',
  Editing: 'edicion',
  Selection: 'edicion',
  Timeline: 'ventana',
  Navigation: 'daw',
  Track: 'daw',
  Mixer: 'daw',
  Clip: 'daw',
  View: 'ui',
  Window: 'ventana',
  System: 'global',
  AI: 'global',
};

function toLegacyCategoria(cat: string): AccionAtajo['categoria'] {
  return CATEGORY_MAP[cat] ?? 'ui';
}

/** Lista canónica para la UI de atajos (IDs en inglés). */
export const ACCIONES_ATAJO: AccionAtajo[] = getActionCatalog().map((a) => ({
  id: a.id,
  descripcion: a.name,
  categoria: toLegacyCategoria(a.category),
  comandoPorDefecto: a.defaultShortcuts?.[0] ?? '',
}));

export const ATAJOS_POR_DEFECTO: Record<string, string> = buildLegacyAtajoMap(buildDefaultKeymap());

export interface AtajoPersistido {
  accionId: string;
  combinacion: string;
}

export type CombinacionAtajo = {
  teclas: string[];
  conTeclaModificadora?: boolean;
};
