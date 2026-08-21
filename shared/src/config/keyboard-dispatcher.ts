/**
 * Adaptador legacy: DespachadorTeclado sobre ActionSystem.
 * Preferir createActionSystem + handleKeyboardEvent para código nuevo.
 */

import type { ActionSystem } from '../actions/action-system';
import { normalizeKeyboardEvent } from '../actions/keyboard-normalizer';
import type { RegistroAcciones } from './action-registry';

export function normalizarEventoTeclado(e: KeyboardEvent): string {
  return normalizeKeyboardEvent(e);
}

export class DespachadorTeclado {
  private _system: ActionSystem | null = null;
  private _mapa = new Map<string, string>();
  private _mapaReverse = new Map<string, string>();
  private _registro: RegistroAcciones | null;

  constructor(registro?: RegistroAcciones) {
    this._registro = registro ?? null;
  }

  attachSystem(system: ActionSystem): void {
    this._system = system;
    this.setMapa(system.getLegacyMap());
  }

  setMapa(mapa: Record<string, string>): void {
    this._mapa.clear();
    this._mapaReverse.clear();
    for (const [accionId, combo] of Object.entries(mapa)) {
      if (combo && accionId) {
        this._mapa.set(accionId, combo);
        this._mapaReverse.set(combo, accionId);
      }
    }
  }

  actualizarCombo(accionId: string, nuevoCombo: string): void {
    if (this._system) {
      this._system.assignShortcut(accionId, nuevoCombo);
      this.setMapa(this._system.getLegacyMap());
      return;
    }
    const comboAnterior = this._mapa.get(accionId);
    if (comboAnterior) this._mapaReverse.delete(comboAnterior);
    this._mapa.set(accionId, nuevoCombo);
    if (nuevoCombo) this._mapaReverse.set(nuevoCombo, accionId);
  }

  restaurarDefaults(atajosPorDefecto: Record<string, string>): void {
    if (this._system) {
      this._system.resetAll();
      this.setMapa(this._system.getLegacyMap());
      return;
    }
    this.setMapa(atajosPorDefecto);
  }

  despachar(e: KeyboardEvent): boolean {
    if (this._system) {
      return this._system.handleKeyboardEvent(e);
    }
    const combo = normalizarEventoTeclado(e);
    if (!combo || !this._registro) return false;
    const accionId = this._mapaReverse.get(combo);
    if (!accionId) return false;
    const ejecutado = this._registro.ejecutar(accionId);
    if (ejecutado) {
      e.preventDefault();
      e.stopPropagation();
    }
    return ejecutado;
  }

  buscarAccion(combo: string): string | undefined {
    if (this._system) {
      const r = this._system.resolver.resolve(combo, this._system.context.get());
      return r?.actionId;
    }
    return this._mapaReverse.get(combo);
  }

  buscarConflictos(combo: string, excluirAccionId?: string): string[] {
    if (this._system) {
      const ctx = this._system.context.get();
      const existing = this._system.shortcuts.getActionId(ctx, combo);
      if (!existing || existing === excluirAccionId) {
        const global = this._system.shortcuts.getActionId('global', combo);
        if (!global || global === excluirAccionId) return [];
        return [global];
      }
      return [existing];
    }
    const conflicto = this._mapaReverse.get(combo);
    if (!conflicto || conflicto === excluirAccionId) return [];
    return [conflicto];
  }

  obtenerComboAccion(accionId: string): string {
    if (this._system) {
      const bindings = this._system.shortcuts.getBindingsForAction(
        this._system.actions.resolveId(accionId) ?? accionId,
      );
      return bindings[0]?.shortcut ?? '';
    }
    return this._mapa.get(accionId) ?? '';
  }

  obtenerMapa(): Record<string, string> {
    if (this._system) return this._system.getLegacyMap();
    return Object.fromEntries(this._mapa);
  }

  get estaVacio(): boolean {
    return this._mapa.size === 0;
  }
}

export function crearDespachador(registro: RegistroAcciones): DespachadorTeclado {
  return new DespachadorTeclado(registro);
}
