/**
 * U3 · Las correcciones automáticas no son silenciosas: emiten
 * `validacion.advertencia` (la UI lo muestra como toast).
 */
import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';

function tiendaConAvisos() {
  const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
  const avisos: Array<{ code?: string; message?: string }> = [];
  tienda.busEventos.on('validacion.advertencia', (evento: unknown) => {
    const e = evento as { payload?: { code?: string; message?: string } };
    avisos.push(e.payload ?? (evento as { code?: string; message?: string }));
  });
  return { tienda, avisos };
}

describe('U3 · avisos visibles', () => {
  it('nombre de pista duplicado → aviso con el nombre corregido', async () => {
    const { tienda, avisos } = tiendaConAvisos();
    await tienda.executor.execute('track.create', { nombre: 'Bajo', tipo: 'audio' });
    await tienda.executor.execute('track.create', { nombre: 'Bajo', tipo: 'audio' });
    const aviso = avisos.find((a) => a.code === 'TRACK_NAME_DUPLICATED');
    expect(aviso?.message).toMatch(/Bajo/);
  });

  it('notas MIDI inválidas descartadas por un comando → aviso con la cantidad', async () => {
    const { tienda, avisos } = tiendaConAvisos();
    const t = await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' });
    const pistaId = (t.result as { trackId: string }).trackId;
    await tienda.executor.execute('midi.clip.create', {
      pistaId,
      inicio: 0,
      duracion: 4,
      notas: [
        { pitch: 60, inicio: 0, duracion: 1 },
        { pitch: 62, inicio: Number.NaN, duracion: 1 },
        { pitch: 64, duracion: 1 },
      ],
    } as never);
    const aviso = avisos.find((a) => a.code === 'MIDI_NOTES_DISCARDED');
    expect(aviso?.message).toMatch(/2 nota/);
  });

  it('sin notas inválidas no hay aviso', async () => {
    const { tienda, avisos } = tiendaConAvisos();
    const t = await tienda.executor.execute('track.create', { nombre: 'Piano', tipo: 'midi' });
    const pistaId = (t.result as { trackId: string }).trackId;
    await tienda.executor.execute('midi.clip.create', { pistaId, notas: [{ pitch: 60, inicio: 0, duracion: 1 }] });
    expect(avisos.some((a) => a.code === 'MIDI_NOTES_DISCARDED')).toBe(false);
  });
});
