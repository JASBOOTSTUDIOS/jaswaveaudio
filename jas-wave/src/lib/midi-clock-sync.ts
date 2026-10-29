/**
 * Alinea el reloj del host (QPC en ns, sellado en el callback de WinMM) con `performance.now()` del renderer.
 *
 * El evento tarda un tiempo variable en llegar (stderr → main → IPC → renderer). El desfase con menor
 * retraso observado es la mejor estimación de la diferencia entre relojes: con él, cada evento recupera
 * su instante real y el jitter del transporte desaparece. El desfase sube muy despacio para seguir la
 * deriva entre relojes sin dejar que un evento lento lo estropee.
 */
export class RelojHostMidi {
  private desfaseMs: number | null = null
  private ultimoEventoMs = 0

  /** ms por evento que puede subir el desfase (deriva de reloj / cambio de carga del sistema). */
  constructor(private readonly derivaMsPorEvento = 0.02) {}

  /**
   * Instante del evento en la escala de `performance.now()` (ms).
   * `ahoraMs` = `performance.now()` al recibirlo. Nunca devuelve un instante futuro.
   */
  mapear(tNs: number, ahoraMs: number): number {
    const hostMs = tNs / 1e6
    const observado = ahoraMs - hostMs
    // Tras mucho tiempo sin eventos (suspensión, cambio de host) la estimación ya no vale: se reinicia.
    if (this.desfaseMs == null || ahoraMs - this.ultimoEventoMs > 60_000 || hostMs < 0) {
      this.desfaseMs = observado
    } else if (observado < this.desfaseMs) {
      this.desfaseMs = observado
    } else {
      this.desfaseMs = Math.min(observado, this.desfaseMs + this.derivaMsPorEvento)
    }
    this.ultimoEventoMs = ahoraMs
    return Math.min(ahoraMs, hostMs + this.desfaseMs)
  }

  reiniciar(): void {
    this.desfaseMs = null
    this.ultimoEventoMs = 0
  }
}
