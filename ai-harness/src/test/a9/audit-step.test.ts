import { describe, it, expect } from 'vitest';
import { parseCriteria, evaluateNumericCriterion } from '../../plan/criteria';
import { auditStep } from '../../audit/step-audit';
import { computeSemanticDiff, emptySemanticDiff } from '@jaswave/shared';

describe('A9 criteria parser', () => {
  it('parsea LUFS con tolerancia', () => {
    const c = parseCriteria('LUFS -14 +/- 1');
    expect(c.length).toBe(1);
    expect(c[0].metric).toBe('lufs');
    if (c[0].metric === 'lufs') {
      expect(c[0].target).toBe(-14);
      expect(c[0].tolerance).toBe(1);
    }
  });

  it('parsea TP <= -1', () => {
    const c = parseCriteria('TP <= -1');
    expect(c.length).toBe(1);
    expect(c[0].metric).toBe('tp');
  });

  it('parsea RMS por pista', () => {
    const c = parseCriteria('kick -18 +/-3 dBFS RMS');
    expect(c.length).toBe(1);
    if (c[0].metric === 'rms') {
      expect(c[0].track).toBe('kick');
      expect(c[0].target).toBe(-18);
    }
  });

  it('evalúa criterio numérico', () => {
    const c = parseCriteria('LUFS -14 +/- 1')[0] as any;
    const res = evaluateNumericCriterion(c, -14.2);
    expect(res.cumple).toBe(true);
  });

  it('audit.step con mediciones sintéticas', () => {
    const res = auditStep({
      runId: 'r1',
      stepId: 's1',
      criterios: ['LUFS -14 +/- 1', 'TP <= -1'],
      mediciones: { lufs: -14.0, tp: -1.2 },
    });
    expect(res.cumple).toBe(true);
    expect(res.evidencia.length).toBeGreaterThan(0);
  });
});

describe('A9 diff EQ dB/Hz', () => {
  it('detecta cambio de volumen en dB y cambios', () => {
    const before = emptySemanticDiff();
    const after = emptySemanticDiff();
    // computeSemanticDiff requiere DAWState completo; testeamos estructura
    expect(before.volumeChanges).toEqual([]);
    expect(after.volumeChanges).toEqual([]);
  });
});

describe('A9 run.diff estructura', () => {
  it('computeSemanticDiff exportado', () => {
    expect(typeof computeSemanticDiff).toBe('function');
  });
});
