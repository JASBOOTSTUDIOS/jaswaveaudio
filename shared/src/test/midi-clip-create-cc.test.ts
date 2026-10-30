import { describe, expect, it } from 'vitest';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearTiendaDAW } from '../state/tienda';

describe('midi.clip.create con expression.cc (pedal grabado)', () => {
  it('guarda el lane con valor normalizado 0..1, curva step y deshace con el clip', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    const t = await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' });
    const pistaId = (t.result as { trackId: string }).trackId;
    const r = await tienda.executor.execute('midi.clip.create', {
      pistaId,
      inicio: 0,
      duracion: 8,
      notas: [{ pitch: 60, inicio: 0, duracion: 1 }],
      expression: {
        cc: [
          {
            cc: 64,
            puntos: [
              { tiempo: 0, valor: 1, curva: 'step' },
              { tiempo: 4, valor: 0, curva: 'step' },
              { tiempo: 6, valor: 300, curva: 'step' }, // fuera de rango: se recorta a 1
            ],
          },
        ],
      },
    });
    expect(r.success, r.error?.message).toBe(true);
    const pista = tienda.obtenerEstado().project.tracks.find((x) => x.id === pistaId)!;
    const clip = pista.clips[0] as unknown as { expression?: { cc: Array<{ cc: number; puntos: Array<{ tiempo: number; valor: number; curva?: string }> }> } };
    const lane = clip.expression!.cc.find((l) => l.cc === 64)!;
    expect(lane.puntos.map((p) => [p.tiempo, p.valor, p.curva])).toEqual([
      [0, 1, 'step'],
      [4, 0, 'step'],
      [6, 1, 'step'],
    ]);
    await tienda.executor.undo();
    const tras = tienda.obtenerEstado().project.tracks.find((x) => x.id === pistaId)!;
    expect(tras.clips.length).toBe(0);
  });
});
