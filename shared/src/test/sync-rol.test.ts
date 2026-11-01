import { describe, expect, it } from 'vitest';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearTiendaDAW } from '../state/tienda';
import { ClienteColaborativo, type RolSala } from '../sync/cliente-colaborativo';
import { crearAplicador } from '../sync/aplicador';
import type { MensajeServidorSync } from '../sync/protocolo';

describe('ClienteColaborativo — rol en la sala', () => {
  it('avisa del rol confirmado al unirse y lo retira al detener', () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    const listeners = new Set<(m: MensajeServidorSync) => void>();
    const roles: (RolSala | null)[] = [];
    const cliente = new ClienteColaborativo({
      ejecutor: tienda.executor,
      aplicar: crearAplicador(crearTiendaDAW({ estadoInicial: crearEstadoInicial() }).executor),
      transporte: {
        enviar: () => undefined,
        alRecibir: (l) => {
          listeners.add(l);
          return () => listeners.delete(l);
        },
      },
      salaId: 'sala',
      clienteId: 'yo',
      alCambiarRol: (r) => roles.push(r),
    });
    cliente.iniciar();
    const bajar = (m: MensajeServidorSync) => listeners.forEach((l) => l(m));

    bajar({ tipo: 'sala.unido', salaId: 'otra', rol: 'owner', ultimoSeq: 0 });
    bajar({ tipo: 'sala.unido', salaId: 'sala', rol: 'viewer', ultimoSeq: 0 });
    bajar({ tipo: 'sala.unido', salaId: 'sala', rol: 'viewer', ultimoSeq: 0 }); // reconexión: sin aviso repetido
    expect(cliente.rolEnSala).toBe('viewer');
    cliente.detener();
    expect(roles).toEqual(['viewer', null]);
    expect(cliente.rolEnSala).toBeNull();
  });
});
