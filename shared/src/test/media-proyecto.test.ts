import { describe, it, expect } from 'vitest';
import {
  esRutaMediaRelativa,
  formatoAudioDesdeRuta,
  nombreArchivoMedia,
  referenciasAudioFaltantes,
  unirRuta,
  verificarReferenciasAudio,
} from '../project/ciclo-vida';
import { proyectoParaGuardar } from '../project/ciclo-vida';
import { cargarProyecto, FileServiceMemoria, guardarProyecto } from '../project/persistencia';
import { proyectoNuevo } from '../project/ciclo-vida';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearComandoClipCreate, crearComandoClipMove, crearComandoClipSetSource, crearComandoTrackCreate } from '../commands/domain-commands';
import type { AudioReference } from '../project/ciclo-vida';
import type { DAWState } from '../types/state';
import type { ProjectState } from '../types/proyecto';

const clipAudio = (id: string, ruta: string) => ({
  id,
  trackId: 'p1',
  nombre: id,
  inicio: 0,
  duracion: 4,
  color: '#fff',
  seleccionado: false,
  tipo: 'audio' as const,
  clipInicio: 0,
  fadeIn: { id: 'f1', clipId: id, tipo: 'in' as const, duracion: 0, curva: 'lineal' as const },
  fadeOut: { id: 'f2', clipId: id, tipo: 'out' as const, duracion: 0, curva: 'lineal' as const },
  warp: false,
  velocidad: 1,
  inverso: false,
  source: { ruta, duracion: 4, sampleRate: 48000, canales: 2, bitDepth: 24 },
});

const proyectoConMedia = (): ProjectState => {
  const base = proyectoNuevo('Con media');
  const pista = {
    id: 'p1',
    nombre: 'Audio 1',
    tipo: 'audio',
    clips: [clipAudio('c1', 'media/intro.wav'), clipAudio('c2', 'media/loop.mp3')],
  };
  return { ...base, tracks: [pista] as never } as ProjectState;
};

describe('Rutas de media del proyecto', () => {
  it('reconoce solo rutas relativas bajo media/', () => {
    expect(esRutaMediaRelativa('media/intro.wav')).toBe(true);
    expect(esRutaMediaRelativa('media/pending/x.wav')).toBe(true);
    expect(esRutaMediaRelativa('media/grabaciones/toma.wav')).toBe(true);
    expect(esRutaMediaRelativa('C:/proyectos/x/media/a.wav')).toBe(false);
    expect(esRutaMediaRelativa('/home/user/a.wav')).toBe(false);
    expect(esRutaMediaRelativa('otro/a.wav')).toBe(false);
    expect(esRutaMediaRelativa('')).toBe(false);
    expect(esRutaMediaRelativa(undefined)).toBe(false);
  });

  it('deduce el formato y el nombre del archivo', () => {
    expect(formatoAudioDesdeRuta('media/a.WAV')).toBe('wav');
    expect(formatoAudioDesdeRuta('media/a.flac')).toBe('flac');
    expect(formatoAudioDesdeRuta('media/a.m4a')).toBe('m4a');
    expect(formatoAudioDesdeRuta('media/a.desconocido')).toBe('wav');
    expect(nombreArchivoMedia('media/grabaciones/toma.wav')).toBe('toma.wav');
  });

  it('une la carpeta del proyecto con la ruta relativa', () => {
    expect(unirRuta('C:/proj', 'media/a.wav')).toBe('C:/proj/media/a.wav');
    expect(unirRuta('C:\\proj\\', 'media/a.wav')).toBe('C:\\proj/media/a.wav');
    expect(unirRuta(undefined, 'media/a.wav')).toBe('media/a.wav');
  });
});

describe('audioReferences derivadas del proyecto', () => {
  it('guarda una referencia por clip de audio con ruta relativa', () => {
    const payload = proyectoParaGuardar(proyectoConMedia());
    expect(Object.keys(payload.audioReferences).sort()).toEqual(['c1', 'c2']);
    expect(payload.audioReferences.c1.rutaRelativa).toBe('media/intro.wav');
    expect(payload.audioReferences.c1.formato).toBe('wav');
    expect(payload.audioReferences.c2.formato).toBe('mp3');
    expect(payload.audioReferences.c1.sampleRate).toBe(48000);
  });

  it('ignora clips con fuente en memoria (no relativa)', () => {
    const proyecto = proyectoConMedia();
    const pista = proyecto.tracks[0] as unknown as { clips: Array<{ source: { ruta: string } }> };
    pista.clips[0]!.source.ruta = 'file-p1-12345';
    const payload = proyectoParaGuardar(proyecto);
    expect(payload.audioReferences.c1).toBeUndefined();
    expect(payload.audioReferences.c2).toBeDefined();
  });
});

describe('Referencias de audio faltantes', () => {
  const refs: Record<string, AudioReference> = {
    c1: { id: 'c1', rutaRelativa: 'media/intro.wav', formato: 'wav', sampleRate: 48000, canales: 2, duracion: 1 },
    c2: { id: 'c2', rutaRelativa: 'media/loop.wav', formato: 'wav', sampleRate: 48000, canales: 2, duracion: 1 },
  };

  it('resuelve la ruta relativa contra la carpeta del proyecto', async () => {
    const fs = new FileServiceMemoria();
    await fs.guardar('C:/proj/media/intro.wav', 'x');
    const faltantes = await referenciasAudioFaltantes(refs, fs, 'C:/proj');
    expect(faltantes.map((r) => r.id)).toEqual(['c2']);
  });

  it('sin fileService solo reporta referencias sin ruta', async () => {
    const faltantes = await verificarReferenciasAudio({
      a1: { id: 'a1', rutaRelativa: 'media/a.wav', formato: 'wav', sampleRate: 48000, canales: 2, duracion: 1 },
      a2: { id: 'a2', rutaRelativa: '', formato: 'wav', sampleRate: 48000, canales: 2, duracion: 1 },
    });
    expect(faltantes).toContain('a2');
    expect(faltantes).not.toContain('a1');
  });
});

describe('Carga de proyecto con media faltante', () => {
  it('avisa de las referencias cuyo archivo no existe', async () => {
    const fs = new FileServiceMemoria();
    const proyecto = proyectoConMedia();
    await guardarProyecto(proyecto, 'C:/proj/proy.jaswave', fs);
    const faltantes: AudioReference[] = [];
    await cargarProyecto('C:/proj/proy.jaswave', fs, {
      onMediaFaltante: (f) => faltantes.push(...f),
    });
    // El FileServiceMemoria no tiene los archivos media: ambos deben avisar.
    expect(faltantes.map((f) => f.id).sort()).toEqual(['c1', 'c2']);
  });

  it('no avisa cuando el media está en la carpeta del proyecto', async () => {
    const fs = new FileServiceMemoria();
    const proyecto = proyectoConMedia();
    await guardarProyecto(proyecto, 'C:/proj/proy.jaswave', fs);
    await fs.guardar('C:/proj/media/intro.wav', 'x');
    await fs.guardar('C:/proj/media/loop.mp3', 'x');
    const faltantes: AudioReference[] = [];
    await cargarProyecto('C:/proj/proy.jaswave', fs, {
      onMediaFaltante: (f) => faltantes.push(...f),
    });
    expect(faltantes).toEqual([]);
  });
});

describe('clip.setSource (reenlace de media)', () => {
  function estadoConClip() {
    const base = crearEstadoInicial();
    const estadoConPista = crearComandoTrackCreate().handler(base, {
      nombre: 'Audio 1',
      tipo: 'audio',
    }) as { state: DAWState };
    const pistas = estadoConPista.state.project.tracks;
    const pista = pistas[pistas.length - 1]!;
    const clip = crearComandoClipCreate().handler(estadoConPista.state, {
      pistaId: pista.id,
      nombre: 'Intro',
      sourceId: 'media/pending/intro.wav',
    }) as { state: DAWState; result?: { clipId?: string } };
    return { estado: clip.state, pistaId: pista.id, clipId: clip.result!.clipId! };
  }

  it('reapunta el clip y deja el proyecto modificado', () => {
    const { estado, pistaId, clipId } = estadoConClip();
    const r = crearComandoClipSetSource().handler(estado, {
      pistaId,
      clipId,
      sourceId: 'media/intro.wav',
    }) as { state: DAWState; inversePayload?: { sourceId?: string } };
    const clip = (r.state.project.tracks.find((t) => t.id === pistaId)?.clips as Array<{
      id: string;
      source?: { ruta?: string };
    }>).find((c) => c.id === clipId);
    expect(clip?.source?.ruta).toBe('media/intro.wav');
    expect(r.state.project.modificado).toBe(true);
    // El inverso devuelve la fuente anterior: undo reapunta el media viejo.
    expect(r.inversePayload?.sourceId).toBe('media/pending/intro.wav');
  });

  it('falla si el clip no existe', () => {
    const { estado, pistaId } = estadoConClip();
    expect(() =>
      crearComandoClipSetSource().handler(estado, { pistaId, clipId: 'nope', sourceId: 'media/a.wav' }),
    ).toThrow(/Clip no encontrado/);
  });
});

describe('clip.move (compatibilidad pista/clip)', () => {
  function estadoConPistas() {
    const base = crearEstadoInicial();
    const conAudio = crearComandoTrackCreate().handler(base, {
      nombre: 'Audio 1',
      tipo: 'audio',
    }) as { state: DAWState };
    const conMidi = crearComandoTrackCreate().handler(conAudio.state, {
      nombre: 'MIDI 1',
      tipo: 'midi',
    }) as { state: DAWState };
    const pistas = conMidi.state.project.tracks;
    const pistaAudio = pistas.find((t) => t.nombre === 'Audio 1')!;
    const pistaMidi = pistas.find((t) => t.nombre === 'MIDI 1')!;
    const clip = crearComandoClipCreate().handler(conMidi.state, {
      pistaId: pistaAudio.id,
      nombre: 'Intro',
      sourceId: 'media/intro.wav',
    }) as { state: DAWState; result?: { clipId?: string } };
    return { estado: clip.state, pistaAudio, pistaMidi, clipId: clip.result!.clipId! };
  }

  it('no deja mover un clip de audio a una pista MIDI', () => {
    const { estado, pistaAudio, pistaMidi, clipId } = estadoConPistas();
    expect(() =>
      crearComandoClipMove().handler(estado, {
        pistaId: pistaAudio.id,
        clipId,
        inicio: 0,
        pistaDestinoId: pistaMidi.id,
      }),
    ).toThrow(/clip de audio/i);
  });

  it('deja mover un clip de audio a otra pista de audio', () => {
    const { estado, pistaAudio, clipId } = estadoConPistas();
    const otra = crearComandoTrackCreate().handler(estado, {
      nombre: 'Audio 2',
      tipo: 'audio',
    }) as { state: DAWState };
    const destino = otra.state.project.tracks.find((t) => t.nombre === 'Audio 2')!;
    const r = crearComandoClipMove().handler(otra.state, {
      pistaId: pistaAudio.id,
      clipId,
      inicio: 2,
      pistaDestinoId: destino.id,
    }) as { state: DAWState };
    const clips = r.state.project.tracks.find((t) => t.id === destino.id)?.clips as Array<{ id: string }>;
    expect(clips.some((c) => c.id === clipId)).toBe(true);
  });
});
