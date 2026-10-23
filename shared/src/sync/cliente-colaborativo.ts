/**
 * Une el ejecutor local, la réplica y el transporte (WebSocket) de una sala colaborativa.
 *
 * - Los cambios locales que notifica el ejecutor (`alReplicar`) se registran como pendientes y se envían.
 * - Los cambios confirmados se incorporan **dentro de la cola del ejecutor** (`enColaExterna`), así
 *   nunca se intercalan con un comando local en curso; luego el ejecutor adopta el estado reconciliado
 *   sin tocar su pila de undo (cada usuario deshace solo lo suyo).
 */

import type { CommandExecutor } from '../state/ejecutor-comandos';
import { cargaDesdeCambio } from './aplicador';
import { COMANDO_CAMBIO, type CambioConfirmado, type MensajeClienteSync, type MensajeServidorSync } from './protocolo';
import { ErrorHuecoSecuencia, ReplicaSync, type AplicadorCambios } from './replica';
import { comparar, fusionar, incrementar, type RelojVectorial } from './reloj-vectorial';

export interface TransporteSync {
  enviar(mensaje: MensajeClienteSync): void;
  /** Devuelve la función para cancelar la suscripción. */
  alRecibir(listener: (mensaje: MensajeServidorSync) => void): () => void;
}

export type OpcionesClienteColaborativo = {
  ejecutor: CommandExecutor;
  aplicar: AplicadorCambios;
  transporte: TransporteSync;
  salaId: string;
  clienteId: string;
  /** Seq ya incorporado en el estado actual del ejecutor (0 si parte de la base de la sala). */
  ultimoSeq?: number;
  /** Se llama cuando llega un cambio remoto concurrente con lo que el cliente había visto. */
  alConflicto?: (cambio: CambioConfirmado) => void;
  alError?: (error: unknown) => void;
};

export class ClienteColaborativo {
  private readonly replica: ReplicaSync;
  private reloj: RelojVectorial = {};
  private cancelaciones: (() => void)[] = [];
  private rol: 'owner' | 'editor' | 'viewer' | null = null;

  constructor(private readonly o: OpcionesClienteColaborativo) {
    this.replica = new ReplicaSync(o.aplicar, o.ejecutor.obtenerEstado(), o.ultimoSeq ?? 0);
  }

  get seq(): number {
    return this.replica.seq;
  }

  get pendientes(): number {
    return this.replica.numPendientes;
  }

  get rolEnSala() {
    return this.rol;
  }

  iniciar(): void {
    this.cancelaciones.push(
      this.o.ejecutor.alReplicar((cambio) => {
        const carga = cargaDesdeCambio(cambio);
        if (!carga) return;
        this.reloj = incrementar(this.reloj, this.o.clienteId);
        this.replica.registrarLocal(carga, cambio.despues);
        this.o.transporte.enviar({
          tipo: 'comando',
          salaId: this.o.salaId,
          clienteId: this.o.clienteId,
          comando: COMANDO_CAMBIO,
          payload: carga,
          vclock: this.reloj,
          baseSeq: this.replica.seq,
        });
      }),
      this.o.transporte.alRecibir((m) => this.manejar(m)),
    );
    this.unirse();
  }

  detener(): void {
    for (const c of this.cancelaciones.splice(0)) c();
  }

  private unirse(): void {
    this.o.transporte.enviar({ tipo: 'sala.unirse', salaId: this.o.salaId, desdeSeq: this.replica.seq });
  }

  private manejar(m: MensajeServidorSync): void {
    if (m.tipo === 'sala.unido' && m.salaId === this.o.salaId) {
      this.rol = m.rol;
      return;
    }
    if (m.tipo !== 'comando.aplicado' || m.salaId !== this.o.salaId || m.comando !== COMANDO_CAMBIO) return;
    const { tipo: _tipo, ...cambio } = m;
    void this.o.ejecutor
      .enColaExterna(async () => {
        if (cambio.clienteId !== this.o.clienteId && comparar(cambio.vclock, this.reloj) === 'concurrente') {
          this.o.alConflicto?.(cambio);
        }
        const r = await this.replica.recibir(cambio);
        this.reloj = fusionar(this.reloj, cambio.vclock);
        if (r.aplicado) this.o.ejecutor.reemplazarEstado(r.estado);
      })
      .catch((err) => {
        if (err instanceof ErrorHuecoSecuencia) this.unirse(); // pide al servidor lo que falta
        else this.o.alError?.(err);
      });
  }
}
