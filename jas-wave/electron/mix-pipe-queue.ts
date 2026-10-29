/**
 * Cola elástica del pipe de mezcla (PCM del renderer → host nativo).
 *
 * Con contrapresión (el pipe no acepta más) los paquetes esperan en una cola acotada por
 * duración en lugar de descartarse: un atasco breve del host ya no produce cortes. Si el
 * atasco dura más que el tope, se descartan los paquetes MÁS ANTIGUOS para que la latencia
 * no crezca sin límite (el audio que suena siempre es el más reciente).
 */

export class ColaPipeMezcla {
  private paquetes: { buf: Buffer; frames: number }[] = []
  private totalFrames = 0
  /** Paquetes descartados por superar el tope (diagnóstico). */
  descartados = 0

  constructor(private maxFrames: number) {}

  get length(): number {
    return this.paquetes.length
  }

  get frames(): number {
    return this.totalFrames
  }

  fijarTope(maxFrames: number): void {
    this.maxFrames = Math.max(1, Math.floor(maxFrames))
  }

  /** Encola y, si se pasa del tope, descarta los más antiguos (siempre conserva el último). */
  encolar(buf: Buffer, frames: number): void {
    this.paquetes.push({ buf, frames })
    this.totalFrames += frames
    while (this.paquetes.length > 1 && this.totalFrames > this.maxFrames) {
      const viejo = this.paquetes.shift()!
      this.totalFrames -= viejo.frames
      this.descartados++
    }
  }

  primero(): Buffer | undefined {
    return this.paquetes[0]?.buf
  }

  quitarPrimero(): void {
    const p = this.paquetes.shift()
    if (p) this.totalFrames -= p.frames
  }

  vaciar(): void {
    this.paquetes = []
    this.totalFrames = 0
  }
}
