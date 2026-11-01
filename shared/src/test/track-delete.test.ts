/**
 * Tests de `track.delete` (U6): guardas de grabación y limpieza de ruteo.
 */

import { describe, it, expect } from 'vitest';
import { crearEstadoInicial } from '../state/estado-inicial';
import {
  crearComandoTrackCreate,
  crearComandoTrackDelete,
  crearComandoTrackRestore,
} from '../commands/domain-commands';
import { crearRegistroComandos } from '../state/registro-comandos';
import { registrarComandosBuiltin } from '../state/comandos-builtin';
import { CommandExecutor } from '../state/ejecutor-comandos';
import { crearPilaDeshacerRehacer } from '../state/pila-deshacer-rehacer';
import { crearRegistroAuditoria } from '../state/registro-auditoria';
import { BusEventosMemoria } from '../events/event-bus';
import type { DAWState } from '../types/state';
import type { Envio, Sidechain, Ruta, ConexionDirecta } from '../types/routing';

function estadoConPistaArmada(grabando: boolean): DAWState {
  const base = crearEstadoInicial();
  const conPista = crearComandoTrackCreate().handler(base, {
    nombre: 'Grabación',
    tipo: 'audio',
  }) as { state: DAWState };
  const pista = conPista.state.project.tracks[conPista.state.project.tracks.length - 1]!;
  const armada = { ...pista, armada: true, estado: 'armado' as const };
  const transport = grabando
    ? { ...conPista.state.transport, grabacion: 'grabando' as const }
    : conPista.state.transport;
  return {
    ...conPista.state,
    transport,
    project: {
      ...conPista.state.project,
      tracks: conPista.state.project.tracks.map((t) => (t.id === pista.id ? armada : t)),
    },
  };
}

describe('track.delete (guardas)', () => {
  it('rechaza borrar una pista armada mientras se graba', () => {
    const estado = estadoConPistaArmada(true);
    const pista = estado.project.tracks[0]!;
    expect(() => crearComandoTrackDelete().handler(estado, { trackId: pista.id })).toThrow(
      /armada y grabando/,
    );
  });

  it('permite borrar una pista armada si no se está grabando', () => {
    const estado = estadoConPistaArmada(false);
    const pista = estado.project.tracks[0]!;
    const r = crearComandoTrackDelete().handler(estado, { trackId: pista.id }) as { state: DAWState };
    expect(r.state.project.tracks.find((t) => t.id === pista.id)).toBeUndefined();
  });
});

describe('track.delete (limpieza de ruteo)', () => {
  function estadoConRuteo(): { estado: DAWState; pistaId: string } {
    const estado = estadoConPistaArmada(false);
    const pistaId = estado.project.tracks[0]!.id;
    const envio: Envio = {
      id: 'e1',
      origenTrackId: pistaId,
      destinoBusId: 'bus1',
      cantidad: 0.5,
      pan: 0,
      activo: true,
      preFader: false,
      solo: false,
      tipo: 'envio',
      tags: [],
      orden: 0,
    };
    const sidechain: Sidechain = {
      id: 'sc1',
      origenTrackId: pistaId,
      destinoTrackId: 'otra',
      activo: true,
      cantidad: 1,
      fuente: 'interna',
      tags: [],
      orden: 0,
    };
    const ruta: Ruta = {
      id: 'r1',
      origen: pistaId,
      destino: 'otra',
      tipo: 'audio',
      activa: true,
      cantidad: 1,
      tags: [],
      orden: 0,
      fase: 0,
      delay: 0,
    };
    const conexion: ConexionDirecta = {
      id: 'cd1',
      origen: pistaId,
      destino: 'otra',
      tipo: 'audio',
      activa: true,
      cantidad: 1,
      tags: [],
      orden: 0,
    };
    return {
      estado: {
        ...estado,
        project: {
          ...estado.project,
          routing: {
            ...estado.project.routing,
            sends: [envio],
            sidechains: [sidechain],
            rutas: [ruta],
            conexionesDirectas: [conexion],
            ordenTracks: [pistaId, 'otra'],
          },
        },
      },
      pistaId,
    };
  }

  it('quita envíos, sidechains, rutas y conexiones de la pista eliminada', () => {
    const { estado, pistaId } = estadoConRuteo();
    const r = crearComandoTrackDelete().handler(estado, { trackId: pistaId }) as { state: DAWState };
    expect(r.state.project.routing.sends).toHaveLength(0);
    expect(r.state.project.routing.sidechains).toHaveLength(0);
    expect(r.state.project.routing.rutas).toHaveLength(0);
    expect(r.state.project.routing.conexionesDirectas).toHaveLength(0);
    expect(r.state.project.routing.ordenTracks).not.toContain(pistaId);
  });

  it('el inverso restaura el ruteo y la pista', () => {
    const { estado, pistaId } = estadoConRuteo();
    const r = crearComandoTrackDelete().handler(estado, { trackId: pistaId }) as {
      state: DAWState;
      inversePayload: { track: unknown; index?: number; ruteo?: { sends?: unknown[] } };
    };
    const restaurado = crearComandoTrackRestore().handler(r.state, r.inversePayload as never) as {
      state: DAWState;
    };
    expect(restaurado.state.project.tracks.some((t) => t.id === pistaId)).toBe(true);
    expect(restaurado.state.project.routing.sends).toHaveLength(1);
    expect(restaurado.state.project.routing.sidechains).toHaveLength(1);
    expect(restaurado.state.project.routing.rutas).toHaveLength(1);
    expect(restaurado.state.project.routing.conexionesDirectas).toHaveLength(1);
  });
});

describe('track.delete (undo del ejecutor)', () => {
  function crearExecutor() {
    const registro = crearRegistroComandos();
    registrarComandosBuiltin(registro);
    return new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });
  }

  it('deshacer track.delete restaura la pista y el envío', async () => {
    const executor = crearExecutor();
    const creada = await executor.execute('track.create', { nombre: 'Guitarra', tipo: 'audio' });
    expect(creada.success).toBe(true);
    const trackId = (creada.result as { trackId: string }).trackId;

    const bus = await executor.execute('bus.create', { nombre: 'Bus FX' });
    expect(bus.success).toBe(true);
    const busId = (bus.result as { busId: string }).busId;

    const send = await executor.execute('send.set', { trackId, busId, amount: 0.5 });
    expect(send.success).toBe(true);

    const borrada = await executor.execute('track.delete', { trackId });
    expect(borrada.success).toBe(true);
    const trasBorrar = executor.obtenerEstado();
    expect(trasBorrar.project.tracks.some((t) => t.id === trackId)).toBe(false);
    expect(trasBorrar.project.routing.sends).toHaveLength(0);

    const deshecho = await executor.undo();
    expect(deshecho.success).toBe(true);
    const restaurado = executor.obtenerEstado();
    expect(restaurado.project.tracks.some((t) => t.id === trackId)).toBe(true);
    expect(restaurado.project.routing.sends).toHaveLength(1);
    expect(restaurado.project.routing.sends[0]?.origenTrackId).toBe(trackId);
  });
});
