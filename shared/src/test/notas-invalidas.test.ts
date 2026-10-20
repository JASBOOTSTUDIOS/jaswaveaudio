import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import { esNotaMidiValida, repararNotasMidi } from '../project/reparar-notas';
import { cargarProyecto, FileServiceMemoria } from '../project/persistencia';
import { proyectoParaGuardar } from '../project/ciclo-vida';

describe('notas MIDI inválidas (NaN / null)', () => {
  it('esNotaMidiValida rechaza campos ausentes, null, NaN y texto', () => {
    expect(esNotaMidiValida({ pitch: 60, inicio: 0, duracion: 1 })).toBe(true);
    expect(esNotaMidiValida({ pitch: 60, duracion: 1 })).toBe(false);
    expect(esNotaMidiValida({ pitch: 60, inicio: null, duracion: 1 })).toBe(false);
    expect(esNotaMidiValida({ pitch: 60, inicio: NaN, duracion: 1 })).toBe(false);
    expect(esNotaMidiValida({ pitch: '60', inicio: 0, duracion: 1 })).toBe(false);
    expect(esNotaMidiValida({ pitch: 60, inicio: 0, duracion: 0 })).toBe(false);
  });

  it('midi.clip.create y midi.notes.set descartan notas sin inicio/duración', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    const t = await tienda.executor.execute('track.create', { nombre: 'M', tipo: 'midi' });
    const trackId = (t.result as { trackId: string }).trackId;
    const c = await tienda.executor.execute('midi.clip.create', {
      pistaId: trackId,
      inicio: 0,
      duracion: 4,
      notas: [
        { pitch: 60, inicio: 0, duracion: 1 },
        { pitch: 62, duracion: 1 },
      ],
    } as never);
    expect(c.success).toBe(true);
    const clip = tienda.obtenerEstado().project.tracks.find((x) => x.id === trackId)!.clips![0] as {
      id: string;
      notas: Array<{ inicio: number }>;
      duracion: number;
    };
    expect(clip.notas).toHaveLength(1);
    expect(Number.isFinite(clip.duracion)).toBe(true);

    await tienda.executor.execute('midi.notes.set', {
      pistaId: trackId,
      clipId: clip.id,
      notas: [{ pitch: 64, inicio: Number.NaN, duracion: 1 }, { pitch: 65, inicio: 1, duracion: 1 }],
    } as never);
    const despues = tienda.obtenerEstado().project.tracks.find((x) => x.id === trackId)!.clips![0] as {
      notas: Array<{ pitch: number; inicio: number }>;
    };
    expect(despues.notas.every((n) => Number.isFinite(n.inicio))).toBe(true);
    expect(despues.notas.map((n) => n.pitch)).toEqual([65]);
  });

  it('un .jaswave con notas null se repara al cargar (no impide abrir)', async () => {
    const proyecto = crearEstadoInicial().project;
    const archivo = proyectoParaGuardar(proyecto) as unknown as { project: { tracks: unknown[] } };
    archivo.project.tracks = [
      {
        id: 'p1',
        nombre: 'Piano',
        tipo: 'midi',
        clips: [
          {
            id: 'c1',
            tipo: 'midi',
            inicio: 0,
            duracion: 4,
            notas: [
              { id: 'n1', pitch: 60, inicio: 0, duracion: 1 },
              { id: 'n2', pitch: 62, inicio: null, duracion: null },
            ],
          },
        ],
        plugins: [],
      },
    ];
    const fs = new FileServiceMemoria();
    await fs.guardar('/p/reparar.jaswave', JSON.stringify(archivo));
    const cargado = await cargarProyecto('/p/reparar.jaswave', fs);
    const notas = (cargado.tracks[0]!.clips![0] as { notas: Array<{ id: string }> }).notas;
    expect(notas.map((n) => n.id)).toEqual(['n1']);
    expect(cargado.modificado).toBe(true);
  });

  it('repararNotasMidi no toca proyectos sanos', () => {
    const p = crearEstadoInicial().project;
    const r = repararNotasMidi(p);
    expect(r.eliminadas).toBe(0);
    expect(r.proyecto).toBe(p);
  });
});
