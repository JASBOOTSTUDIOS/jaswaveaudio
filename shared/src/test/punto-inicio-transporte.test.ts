/**
 * Punto de inicio del transporte: lo fija un seek del usuario (marcarInicio), Stop vuelve a él y W/Inicio
 * (seek a 0 con marcarInicio) lo devuelve a cero. Los seeks automáticos (bucle, IA) no lo mueven.
 */
import { describe, it, expect } from 'vitest';
import { crearTiendaDAW } from '../state/tienda';
import { crearEstadoInicial } from '../state/estado-inicial';
import { puntoInicioDe } from '../commands/domain-commands';

async function ejecutar(tienda: ReturnType<typeof crearTiendaDAW>, type: string, payload: Record<string, unknown>) {
  const r = await tienda.executor.execute(type, payload);
  expect(r.success, `${type}: ${r.error?.message ?? ''}`).toBe(true);
}

const segundos = (tienda: ReturnType<typeof crearTiendaDAW>) => tienda.obtenerEstado().transport.posicion.segundos;

describe('punto de inicio del transporte', () => {
  it('stop vuelve al punto marcado por el usuario, no al cero', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await ejecutar(tienda, 'transport.seek', { segundos: 12, marcarInicio: true });
    await ejecutar(tienda, 'transport.toggle', {});
    await ejecutar(tienda, 'transport.seek', { segundos: 30 }); // avance / salto automático
    await ejecutar(tienda, 'transport.stop', {});
    expect(segundos(tienda)).toBeCloseTo(12, 6);
    expect(tienda.obtenerEstado().transport.reproduciendo).toBe(false);
  });

  it('un seek sin marcarInicio no mueve el punto', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await ejecutar(tienda, 'transport.seek', { segundos: 5, marcarInicio: true });
    await ejecutar(tienda, 'transport.seek', { segundos: 40 });
    expect(puntoInicioDe(tienda.obtenerEstado().transport)).toBe(5);
  });

  it('W (seek a 0 con marcarInicio) devuelve el punto a cero', async () => {
    const tienda = crearTiendaDAW({ estadoInicial: crearEstadoInicial() });
    await ejecutar(tienda, 'transport.seek', { segundos: 8, marcarInicio: true });
    await ejecutar(tienda, 'transport.seek', { segundos: 0, marcarInicio: true });
    await ejecutar(tienda, 'transport.seek', { segundos: 20 });
    await ejecutar(tienda, 'transport.stop', {});
    expect(segundos(tienda)).toBe(0);
  });

  it('sin punto fijado (proyectos antiguos) stop va a 0', () => {
    expect(puntoInicioDe(undefined)).toBe(0);
    expect(puntoInicioDe({ puntoInicio: Number.NaN })).toBe(0);
    expect(puntoInicioDe({ puntoInicio: -3 })).toBe(0);
  });
});
