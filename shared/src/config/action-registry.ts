/**
 * Registro centralizado de acciones del DAW.
 *
 * Propósito:
 *   Mapear cada acción del DAW que se puede disparar con un atajo
 *   a su handler correspondiente. Es la fuente de verdad para saber
 *   qué acciones existen y cómo ejecutarlas.
 *
 * Importancia:
 *   - Decouple la detección de teclado de la ejecución de acciones.
 *   - Permite disparar acciones desde múltiples fuentes (teclado, menús, paleta).
 *   - Facilita testing: se puede registrar un handler mock para cada acción.
 */

export type ManejadorAccion = () => void | Promise<void>

export interface DefinicionAccion {
  id: string
  descripcion: string
  categoria: string
}

export class RegistroAcciones {
  private _acciones = new Map<string, ManejadorAccion>()
  private _definiciones = new Map<string, DefinicionAccion>()

  registrar(id: string, handler: ManejadorAccion, definicion?: Omit<DefinicionAccion, 'id'>): void {
    this._acciones.set(id, handler)
    if (definicion) {
      this._definiciones.set(id, { id, ...definicion })
    }
  }

  ejecutar(id: string): boolean {
    const handler = this._acciones.get(id)
    if (!handler) return false
    try {
      void handler()
      return true
    } catch {
      return false
    }
  }

  tieneAccion(id: string): boolean {
    return this._acciones.has(id)
  }

  listarAcciones(): string[] {
    return Array.from(this._acciones.keys())
  }

  listarDefiniciones(): DefinicionAccion[] {
    return Array.from(this._definiciones.values())
  }
}

export function crearRegistroAcciones(): RegistroAcciones {
  return new RegistroAcciones()
}
