/**
 * Helpers de expresión MIDI (CC / pitch bend) sobre MidiClip.expression.
 */

import type {
  MidiAutomationPoint,
  MidiCcLane,
  MidiClip,
  MidiClipExpression,
} from '../types/clips';

function genId(): string {
  return `exp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyExpression(): MidiClipExpression {
  return { cc: [], pitchBend: [], channelPressure: [] };
}

export function ensureExpression(clip: MidiClip): MidiClipExpression {
  return clip.expression ?? emptyExpression();
}

export function upsertCcPoint(
  expression: MidiClipExpression,
  cc: number,
  tiempo: number,
  valor: number,
  nombre?: string,
): MidiClipExpression {
  const v = Math.max(0, Math.min(1, valor));
  const lanes = [...(expression.cc ?? [])];
  let lane = lanes.find((l) => l.cc === cc);
  if (!lane) {
    lane = { cc, nombre: nombre ?? `CC${cc}`, puntos: [] };
    lanes.push(lane);
  }
  const puntos = [...lane.puntos];
  const existing = puntos.findIndex((p) => Math.abs(p.tiempo - tiempo) < 1e-6);
  const point: MidiAutomationPoint = {
    id: existing >= 0 ? puntos[existing]!.id : genId(),
    tiempo,
    valor: v,
    curva: 'linear',
  };
  if (existing >= 0) puntos[existing] = point;
  else puntos.push(point);
  puntos.sort((a, b) => a.tiempo - b.tiempo);
  const nextLane: MidiCcLane = { ...lane, puntos };
  const idx = lanes.findIndex((l) => l.cc === cc);
  lanes[idx] = nextLane;
  return { ...expression, cc: lanes };
}

export function setCcLane(
  expression: MidiClipExpression,
  cc: number,
  puntos: { id?: string; tiempo: number; valor: number }[],
  nombre?: string,
): MidiClipExpression {
  const lanes = (expression.cc ?? []).filter((l) => l.cc !== cc);
  lanes.push({
    cc,
    nombre: nombre ?? `CC${cc}`,
    puntos: puntos.map((p) => ({
      id: p.id ?? genId(),
      tiempo: p.tiempo,
      valor: Math.max(0, Math.min(1, p.valor)),
      curva: 'linear' as const,
    })),
  });
  return { ...expression, cc: lanes };
}

export function setPitchBendPoints(
  expression: MidiClipExpression,
  puntos: { id?: string; tiempo: number; valor: number }[],
): MidiClipExpression {
  // valor: -1..1 → se almacena normalizado; MIDI raw = valor * 8191
  return {
    ...expression,
    pitchBend: puntos.map((p) => ({
      id: p.id ?? genId(),
      tiempo: p.tiempo,
      valor: Math.max(-1, Math.min(1, p.valor)),
      curva: 'smooth' as const,
    })),
  };
}

export function pitchBendToMidi(normalized: number): number {
  return Math.round(Math.max(-1, Math.min(1, normalized)) * 8191);
}

export function midiToPitchBend(raw: number): number {
  return Math.max(-1, Math.min(1, raw / 8191));
}

export function sampleAutomation(
  puntos: MidiAutomationPoint[],
  tiempo: number,
): number | null {
  if (!puntos.length) return null;
  const sorted = [...puntos].sort((a, b) => a.tiempo - b.tiempo);
  if (tiempo <= sorted[0]!.tiempo) return sorted[0]!.valor;
  if (tiempo >= sorted[sorted.length - 1]!.tiempo) return sorted[sorted.length - 1]!.valor;
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (tiempo >= a.tiempo && tiempo <= b.tiempo) {
      if (a.curva === 'step') return a.valor;
      const t = (tiempo - a.tiempo) / Math.max(1e-9, b.tiempo - a.tiempo);
      const s = a.curva === 'smooth' ? t * t * (3 - 2 * t) : t;
      return a.valor + (b.valor - a.valor) * s;
    }
  }
  return null;
}
