/**
 * Pila de undo/redo con soporte de boundaries y restauración atómica.
 */

import type { Command } from '../types/command';

export interface UndoRedoStack {
  undoStack: Command[];
  redoStack: Command[];
  maxSize: number;
}

export interface PilaSnapshot {
  undo: Command[];
  redo: Command[];
}

export interface PilaDeshacerRehacer {
  undo(): Command | null;
  redo(): Command | null;
  push(command: Command): void;
  limpiarRedo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  getUndoStack(): Command[];
  getRedoStack(): Command[];
  /** Snapshot para rollback de batch. */
  snapshot(): PilaSnapshot;
  /** Restaura ambas pilas (p. ej. tras batch fallido). */
  restore(snapshot: PilaSnapshot): void;
  /** Quita de undo sin empujar a redo (rollback parcial). */
  popUndoSinRedo(): Command | null;
}

export function crearPilaDeshacerRehacer(maxSize = 1000): PilaDeshacerRehacer {
  const undoStack: Command[] = [];
  const redoStack: Command[] = [];

  return {
    undo(): Command | null {
      if (undoStack.length === 0) return null;
      const command = undoStack.pop()!;
      redoStack.push(command);
      return command;
    },

    redo(): Command | null {
      if (redoStack.length === 0) return null;
      const command = redoStack.pop()!;
      undoStack.push(command);
      return command;
    },

    push(command: Command): void {
      undoStack.push(command);
      if (undoStack.length > maxSize) {
        undoStack.shift();
      }
      redoStack.length = 0;
    },

    limpiarRedo(): void {
      redoStack.length = 0;
    },

    canUndo(): boolean {
      return undoStack.length > 0;
    },

    canRedo(): boolean {
      return redoStack.length > 0;
    },

    getUndoStack(): Command[] {
      return [...undoStack];
    },

    getRedoStack(): Command[] {
      return [...redoStack];
    },

    snapshot(): PilaSnapshot {
      return { undo: [...undoStack], redo: [...redoStack] };
    },

    restore(snapshot: PilaSnapshot): void {
      undoStack.length = 0;
      redoStack.length = 0;
      undoStack.push(...snapshot.undo);
      redoStack.push(...snapshot.redo);
    },

    popUndoSinRedo(): Command | null {
      if (undoStack.length === 0) return null;
      return undoStack.pop()!;
    },
  };
}
