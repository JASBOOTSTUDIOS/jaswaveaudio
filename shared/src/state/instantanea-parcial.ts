/**
 * Instantánea parcial para undo de comandos sin inverso explícito.
 *
 * Propósito:
 *   Dar undo/redo a comandos como `automation.*`, `take.*`, `project.update`,
 *   `master.update`, `bus.create`… sin escribir un inverso a mano para cada uno.
 *
 * Cómo funciona:
 *   Compara el estado antes/después del comando y guarda solo lo que cambió:
 *     - claves de primer nivel de `project` (salvo `tracks`, `modificado`,
 *       `fechaModificacion`);
 *     - por pista: los campos que cambiaron (o la pista entera si se creó/borró)
 *       y el orden de pistas;
 *     - claves de primer nivel de `transport`.
 *   Deshacer/rehacer aplica esos campos sobre el estado ACTUAL, de modo que no
 *   pisa campos que el comando no tocó (p. ej. el estado de plugins que el
 *   autosave escribe sin pasar por la pila).
 */

import type { DAWState } from '../types/state';
import type { Track } from '../types/tracks';
import { entorno } from './entorno-determinista';

type Registro = Record<string, unknown>;

/** Valores de las claves que cambiaron, en cada lado (undefined = la clave no existía). */
export interface CambioClaves {
  antes: Registro;
  despues: Registro;
}

export type CambioPista =
  | { modo: 'campos'; cambio: CambioClaves }
  | { modo: 'entera'; antes: Track | undefined; despues: Track | undefined };

export interface InstantaneaParcial {
  proyecto: CambioClaves | null;
  pistas: { ordenAntes: string[]; ordenDespues: string[]; cambios: Map<string, CambioPista> } | null;
  transporte: CambioClaves | null;
}

export type LadoInstantanea = 'antes' | 'despues';

const CLAVES_PROYECTO_IGNORADAS = new Set(['tracks', 'modificado', 'fechaModificacion']);
const CLAVES_PISTA_IGNORADAS = new Set(['fechaModificacion']);

function diffClaves(a: unknown, b: unknown, ignoradas?: ReadonlySet<string>): CambioClaves | null {
  if (a === b) return null;
  const ra = (a ?? {}) as Registro;
  const rb = (b ?? {}) as Registro;
  const antes: Registro = {};
  const despues: Registro = {};
  let hay = false;
  const claves = new Set([...Object.keys(ra), ...Object.keys(rb)]);
  for (const clave of claves) {
    if (ignoradas?.has(clave)) continue;
    if (ra[clave] === rb[clave]) continue;
    antes[clave] = ra[clave];
    despues[clave] = rb[clave];
    hay = true;
  }
  return hay ? { antes, despues } : null;
}

function aplicarClaves<T>(base: T, valores: Registro): T {
  const out = { ...(base as Registro) };
  for (const [clave, valor] of Object.entries(valores)) {
    if (valor === undefined) delete out[clave];
    else out[clave] = valor;
  }
  return out as T;
}

function diffPistas(antes: Track[], despues: Track[]): InstantaneaParcial['pistas'] {
  if (antes === despues) return null;
  const porIdAntes = new Map(antes.map((t) => [t.id, t]));
  const porIdDespues = new Map(despues.map((t) => [t.id, t]));
  const cambios = new Map<string, CambioPista>();
  for (const [id, tAntes] of porIdAntes) {
    const tDespues = porIdDespues.get(id);
    if (!tDespues) {
      cambios.set(id, { modo: 'entera', antes: tAntes, despues: undefined });
    } else if (tAntes !== tDespues) {
      const cambio = diffClaves(tAntes, tDespues, CLAVES_PISTA_IGNORADAS);
      if (cambio) cambios.set(id, { modo: 'campos', cambio });
    }
  }
  for (const [id, tDespues] of porIdDespues) {
    if (!porIdAntes.has(id)) cambios.set(id, { modo: 'entera', antes: undefined, despues: tDespues });
  }
  const ordenAntes = antes.map((t) => t.id);
  const ordenDespues = despues.map((t) => t.id);
  const mismoOrden = ordenAntes.length === ordenDespues.length && ordenAntes.every((id, i) => id === ordenDespues[i]);
  if (cambios.size === 0 && mismoOrden) return null;
  return { ordenAntes, ordenDespues, cambios };
}

/** Captura lo que cambió entre dos estados; `null` si el comando no cambió nada relevante. */
export function capturarInstantaneaParcial(antes: DAWState, despues: DAWState): InstantaneaParcial | null {
  const proyecto = antes.project === despues.project
    ? null
    : diffClaves(antes.project, despues.project, CLAVES_PROYECTO_IGNORADAS);
  const pistas = antes.project === despues.project
    ? null
    : diffPistas(antes.project?.tracks ?? [], despues.project?.tracks ?? []);
  const transporte = diffClaves(antes.transport, despues.transport);
  if (!proyecto && !pistas && !transporte) return null;
  return { proyecto, pistas, transporte };
}

function aplicarPistas(actuales: Track[], pistas: NonNullable<InstantaneaParcial['pistas']>, lado: LadoInstantanea): Track[] {
  const porId = new Map(actuales.map((t) => [t.id, t]));
  const orden = lado === 'antes' ? pistas.ordenAntes : pistas.ordenDespues;
  const usados = new Set<string>();
  const resultado: Track[] = [];
  const ahora = entorno.ahora();
  for (const id of orden) {
    usados.add(id);
    const cambio = pistas.cambios.get(id);
    if (!cambio) {
      const actual = porId.get(id);
      if (actual) resultado.push(actual);
      continue;
    }
    if (cambio.modo === 'entera') {
      const valor = cambio[lado];
      if (valor) resultado.push(valor);
      continue;
    }
    const actual = porId.get(id);
    if (!actual) continue;
    resultado.push({ ...aplicarClaves(actual, cambio.cambio[lado]), fechaModificacion: ahora } as Track);
  }
  // Pistas que existen ahora pero no estaban en ningún lado (creadas fuera de la pila): se conservan.
  for (const t of actuales) {
    if (usados.has(t.id)) continue;
    const cambio = pistas.cambios.get(t.id);
    if (cambio?.modo === 'entera' && cambio[lado] === undefined) continue;
    resultado.push(t);
  }
  return resultado;
}

/** Aplica un lado de la instantánea sobre el estado actual. */
export function aplicarInstantaneaParcial(estado: DAWState, inst: InstantaneaParcial, lado: LadoInstantanea): DAWState {
  let project = estado.project;
  if (inst.proyecto || inst.pistas) {
    project = inst.proyecto ? aplicarClaves(project, inst.proyecto[lado]) : { ...project };
    if (inst.pistas) project = { ...project, tracks: aplicarPistas(estado.project.tracks ?? [], inst.pistas, lado) };
    project = { ...project, modificado: true, fechaModificacion: entorno.ahora() };
  }
  const transport = inst.transporte ? aplicarClaves(estado.transport, inst.transporte[lado]) : estado.transport;
  return { ...estado, project, transport };
}
