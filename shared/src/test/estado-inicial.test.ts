/**
 * Tests de serialización round-trip y factory de estado inicial.
 */

import { describe, it, expect } from 'vitest';
import { crearEstadoInicial } from '../state/estado-inicial';
import { crearTiendaDAW } from '../state/tienda';
import { ConsultaDAW } from '../state/consulta';
import { validarEstado } from '../state/validador';
import { ejecutarMigraciones } from '../state/migraciones';
import type { DAWState } from '../types/state';
import type { DAWStateMigration } from '../types/state';

describe('crearEstadoInicial', () => {
  it('deberia crear un DAWState valido', () => {
    const estado = crearEstadoInicial();
    expect(estado.project.id).toBeTruthy();
    expect(estado.project.nombre).toBe('Proyecto sin nombre');
    expect(estado.transport.bpm).toBe(120);
    expect(estado.ui.tema).toBe('sistema');
    expect(estado.ui.herramientaActiva).toBe('select');
    expect(estado.ui.modoEdicion).toBe('arrange');
    expect(estado.project.tracks).toHaveLength(0);
    expect(estado.historial.acciones).toHaveLength(0);
  });

  it('deberia generar ids unicos por llamada', () => {
    const estado1 = crearEstadoInicial();
    const estado2 = crearEstadoInicial();
    expect(estado1.project.id).not.toBe(estado2.project.id);
    expect(estado1.dispositivoId).not.toBe(estado2.dispositivoId);
    expect(estado1.sesionId).not.toBe(estado2.sesionId);
  });
});

describe('serializacion round-trip', () => {
  it('deberia serializar y deserializar DAWState sin perdida de estructuras basicas', () => {
    const estadoOriginal = crearEstadoInicial();
    const json = JSON.stringify(estadoOriginal);
    const estadoRecuperado = JSON.parse(json) as DAWState;

    expect(estadoRecuperado.project.id).toBe(estadoOriginal.project.id);
    expect(estadoRecuperado.project.nombre).toBe(estadoOriginal.project.nombre);
    expect(estadoRecuperado.project.bpm.valor).toBe(estadoOriginal.project.bpm.valor);
    expect(estadoRecuperado.transport.bpm).toBe(estadoOriginal.transport.bpm);
    expect(estadoRecuperado.ui.tema).toBe(estadoOriginal.ui.tema);
    expect(estadoRecuperado.ui.herramientaActiva).toBe(estadoOriginal.ui.herramientaActiva);
    expect(estadoRecuperado.project.configuracion.sampleRate).toBe(estadoOriginal.project.configuracion.sampleRate);
  });

  it('deberia preservar arrays y objetos anidados', () => {
    const estado = crearEstadoInicial();
    const json = JSON.stringify(estado);
    const recuperado = JSON.parse(json) as DAWState;

    expect(Array.isArray(recuperado.project.tracks)).toBe(true);
    expect(Array.isArray(recuperado.historial.acciones)).toBe(true);
    expect(typeof recuperado.project.configuracion).toBe('object');
    expect(typeof recuperado.transport.metronomo).toBe('object');
  });
});

describe('TiendaDAW', () => {
  it('deberia exponer el estado inicial', () => {
    const estadoInicial = crearEstadoInicial();
    const tienda = crearTiendaDAW({ estadoInicial });
    expect(tienda.obtenerEstado().project.id).toBe(estadoInicial.project.id);
  });

  it('deberia notificar cambios a los listeners', () => {
    const estadoInicial = crearEstadoInicial();
    const tienda = crearTiendaDAW({ estadoInicial });
    const cambios: string[] = [];
    const desuscripcion = tienda.suscribir((estadoNuevo, _estadoAnterior) => {
      cambios.push(estadoNuevo.project.nombre);
    });

    tienda.establecerEstado({ project: { ...estadoInicial.project, nombre: 'Nuevo nombre' } });
    expect(cambios).toContain('Nuevo nombre');

    desuscripcion();
  });

  it('deberia despachar comandos', async () => {
    const estadoInicial = crearEstadoInicial();
    const tienda = crearTiendaDAW({ estadoInicial });

    const nuevoEstado = await tienda.despachar({ type: 'project.new', payload: { nombre: 'Renombrado' } });
    expect(nuevoEstado.project.nombre).toBe('Renombrado');
  });
});

describe('ConsultaDAW', () => {
  it('deberia consultar el estado inicial sin efectos secundarios', () => {
    const estado = crearEstadoInicial();
    const consulta = new ConsultaDAW(estado);

    const resumen = consulta.obtenerResumenProyecto();
    expect(resumen.nombre).toBe('Proyecto sin nombre');
    expect(resumen.bpm).toBe(120);

    const pistas = consulta.obtenerPistas();
    expect(pistas).toHaveLength(0);

    const transporte = consulta.obtenerTransporte();
    expect(transporte.reproduciendo).toBe(false);
    expect(transporte.bpm).toBe(120);
  });

  it('deberia buscar pistas y clips', () => {
    const estado = crearEstadoInicial();
    const consulta = new ConsultaDAW(estado);
    const resultados = consulta.buscar('sin nombre');
    expect(resultados).toHaveLength(0);
  });
});

describe('validadorEstado', () => {
  it('deberia validar el estado inicial sin errores', () => {
    const estado = crearEstadoInicial();
    const resultado = validarEstado(estado);
    expect(resultado.validado).toBe(true);
    expect(resultado.errores).toHaveLength(0);
  });
});

describe('ejecutarMigraciones', () => {
  it('deberia aplicar migraciones secuencialmente', () => {
    const estado = crearEstadoInicial();
    const migraciones: DAWStateMigration[] = [
      {
        versionOrigen: estado.esquemaVersion,
        versionDestino: '1.1.0',
        esquemaVersion: '1.1.0',
        migraciones: [
          {
            nombre: 'agregarCampoDemo',
            descripcion: 'Agrega campo de prueba',
            ejecutar: (s: DAWState) => ({ ...s, version: '1.1.0' }),
            reversible: true,
          },
        ],
        validar: () => true,
      },
    ];

    const resultado = ejecutarMigraciones(estado, migraciones);
    expect(resultado.exito).toBe(true);
    expect(resultado.migracionesAplicadas).toContain('1.1.0');
  });

  it('deberia fallar si la version origen no coincide', () => {
    const estado = crearEstadoInicial();
    const migraciones: DAWStateMigration[] = [
      {
        versionOrigen: '9.9.9',
        versionDestino: '1.0.0',
        esquemaVersion: '1.0.0',
        migraciones: [],
        validar: () => true,
      },
    ];

    const resultado = ejecutarMigraciones(estado, migraciones);
    expect(resultado.exito).toBe(false);
    expect(resultado.errores.length).toBeGreaterThan(0);
  });
});
