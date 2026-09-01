/**
 * DSP de mezcla / PDC compartido entre tests y UI.
 * El host C++ replica constantPowerGains y delayCompensation en renderMix.
 */

/** Paneo constant-power: pan -1..1 → ganancias L/R. Centro = -3 dB (cos/sin π/4). */
export function constantPowerGains(gain: number, pan: number): { gL: number; gR: number } {
  const g = Math.max(0, Math.min(2, gain))
  const p = Math.max(-1, Math.min(1, pan))
  const theta = (p + 1) * (Math.PI / 4)
  return { gL: g * Math.cos(theta), gR: g * Math.sin(theta) }
}

/**
 * Compensación de latencia por pista: cada pista se retrasa
 * `max(latencies) - latency[i]` samples para alinear al insert más lento.
 * Master no entra: su latencia es común a toda la suma.
 */
export function delayCompensation(trackLatencies: number[], maxDelay = 16384): number[] {
  let maxLat = 0
  const lat = trackLatencies.map((n) => {
    const v = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
    if (v > maxLat) maxLat = v
    return v
  })
  const cap = Math.max(0, Math.floor(maxDelay))
  if (maxLat > cap) maxLat = cap
  return lat.map((v) => Math.min(cap, Math.max(0, maxLat - Math.min(v, cap))))
}

/** Pico lineal 0..1 desde un bloque time-domain (AnalyserNode). */
export function peakFromTimeDomain(samples: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i])
    if (a > peak) peak = a
  }
  return peak > 1 ? 1 : peak
}

/** Pico desde getByteTimeDomainData (128 = silencio). */
export function peakFromByteTimeDomain(bytes: ArrayLike<number>): number {
  let peak = 0
  for (let i = 0; i < bytes.length; i++) {
    const a = Math.abs(bytes[i] - 128) / 128
    if (a > peak) peak = a
  }
  return peak > 1 ? 1 : peak
}
