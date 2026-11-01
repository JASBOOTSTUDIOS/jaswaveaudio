/**
 * Réplica de un proyecto colaborativo con reconciliación determinista.
 *
 * - `confirmado`: plegado de todos los cambios en el orden total del servidor (seq 1..n).
 * - `pendientes`: cambios locales enviados y aún no confirmados, en orden de emisión.
 * - `estado` (optimista) = confirmado + pendientes reaplicados encima (rebase).
 *
 * Todas las réplicas pliegan la misma secuencia con el mismo aplicador determinista, así que al
 * vaciarse los pendientes convergen al mismo estado. Un cambio que deja de ser válido sobre la nueva
 * base (p. ej. editar una nota que otro borró) se descarta igual en todas las réplicas.
 */

import type { DAWState } from '../types/state';
import type { CambioConfirmado, CargaCambio } from './protocolo';

/** Aplica un cambio sobre un estado; devuelve `null` si no es aplicable sobre esa base. */
export type AplicadorCambios = (estado: DAWState, carga: CargaCambio) => Promise<DAWState | null>;

export class ErrorHuecoSecuencia extends Error {
  constructor(
    public readonly esperado: number,
    public readonly recibido: number,
  ) {
    super(`hueco en la secuencia: se esperaba ${esperado} y llegó ${recibido}`);
    this.name = 'ErrorHuecoSecuencia';
  }
}

export class ReplicaSync {
  private confirmado: DAWState;
  private ultimoSeq: number;
  private pendientes: CargaCambio[] = [];
  private optimista: DAWState;

  constructor(
    private readonly aplicar: AplicadorCambios,
    estadoConfirmado: DAWState,
    ultimoSeq = 0,
  ) {
    this.confirmado = estadoConfirmado;
    this.optimista = estadoConfirmado;
    this.ultimoSeq = ultimoSeq;
  }

  /** Estado que ve el usuario (confirmado + sus cambios pendientes). */
  get estado(): DAWState {
    return this.optimista;
  }

  get estadoConfirmado(): DAWState {
    return this.confirmado;
  }

  get seq(): number {
    return this.ultimoSeq;
  }

  get numPendientes(): number {
    return this.pendientes.length;
  }

  /** Registra un cambio local ya aplicado (su resultado es `estadoLocal`) y pendiente de confirmar. */
  registrarLocal(carga: CargaCambio, estadoLocal: DAWState): void {
    this.pendientes.push(carga);
    this.optimista = estadoLocal;
  }

  /**
   * Incorpora un cambio confirmado por el servidor. Ignora duplicados; un hueco en `seq` lanza
   * `ErrorHuecoSecuencia` (hay que volver a unirse con `desdeSeq = seq` para recibir lo que falta).
   */
  async recibir(cambio: CambioConfirmado): Promise<{ estado: DAWState; aplicado: boolean }> {
    if (cambio.seq <= this.ultimoSeq) return { estado: this.optimista, aplicado: false };
    if (cambio.seq !== this.ultimoSeq + 1) throw new ErrorHuecoSecuencia(this.ultimoSeq + 1, cambio.seq);

    this.confirmado = (await this.aplicar(this.confirmado, cambio.payload)) ?? this.confirmado;
    this.ultimoSeq = cambio.seq;

    const propio = this.pendientes.findIndex((p) => p.id === cambio.payload.id);
    if (propio >= 0) this.pendientes.splice(propio, 1);

    let estado = this.confirmado;
    for (const p of this.pendientes) estado = (await this.aplicar(estado, p)) ?? estado;
    this.optimista = estado;
    return { estado, aplicado: true };
  }
}
