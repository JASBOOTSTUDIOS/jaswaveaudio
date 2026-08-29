import { describe, it, expect } from 'vitest';
import { crearRegistroComandos } from '../state/registro-comandos';
import { registrarComandosBuiltin } from '../state/comandos-builtin';
import { CommandExecutor } from '../state/ejecutor-comandos';
import { crearPilaDeshacerRehacer } from '../state/pila-deshacer-rehacer';
import { crearRegistroAuditoria } from '../state/registro-auditoria';
import { crearEstadoInicial } from '../state/estado-inicial';
import { BusEventosMemoria } from '../events/event-bus';
import type { DAWState } from '../types/state';
import type { CommandDefinition } from '../types/command';

describe('ComandosBuiltin', () => {
  it('deberia registrar comandos de proyecto en el registry', async () => {
    const registro = crearRegistroComandos();
    const { registrarComandosBuiltin } = await import('../state/comandos-builtin');
    registrarComandosBuiltin(registro);

    const lista = registro.list();
    const tipos = lista.map(c => c.type);
    expect(tipos).toContain('project.new');
    expect(tipos).toContain('project.save');
    expect(tipos).toContain('project.load');
    expect(tipos).toContain('project.close');
  });

  it('deberia crear un proyecto nuevo', async () => {
    const registro = crearRegistroComandos();
    const { registrarComandosBuiltin } = await import('../state/comandos-builtin');
    registrarComandosBuiltin(registro);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    const resultado = await executor.execute('project.new', { nombre: 'Nuevo Nombre' });
    expect(resultado.success).toBe(true);
    expect((resultado.result as { nombre: string }).nombre).toBe('Nuevo Nombre');
    expect(executor.obtenerEstado().project.nombre).toBe('Nuevo Nombre');
  });

  it('deberia rechazar crear proyecto sin nombre', async () => {
    const registro = crearRegistroComandos();
    const { registrarComandosBuiltin } = await import('../state/comandos-builtin');
    registrarComandosBuiltin(registro);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    const resultado = await executor.execute('project.new', { nombre: '' });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('EXECUTION_ERROR');
  });

  it('deberia solicitar confirmacion al cerrar proyecto con cambios sin guardar', async () => {
    const registro = crearRegistroComandos();
    const { registrarComandosBuiltin } = await import('../state/comandos-builtin');
    registrarComandosBuiltin(registro);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    await executor.execute('project.new', { nombre: 'Con Cambios' });
    const estadoConCambios = executor.obtenerEstado();
    const estadoModificado = { ...estadoConCambios, project: { ...estadoConCambios.project, modificado: true } } as any;
    (executor as any)['estado'] = estadoModificado;

    const resultado = await executor.execute('project.close', {});
    expect(resultado.success).toBe(true);
    expect((resultado.result as any).requiereConfirmacion).toBe(true);
    expect(executor.obtenerEstado().project).toBeDefined();
  });

  it('deberia cerrar proyecto sin cambios directamente', async () => {
    const registro = crearRegistroComandos();
    const { registrarComandosBuiltin } = await import('../state/comandos-builtin');
    registrarComandosBuiltin(registro);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    await executor.execute('project.new', { nombre: 'Sin Cambios' });
    const resultado = await executor.execute('project.close', {});
    expect(resultado.success).toBe(true);
    expect((resultado.result as any).requiereConfirmacion).toBeUndefined();
    expect(executor.obtenerEstado().project).toBeDefined();
    expect(executor.obtenerEstado().project.nombre).toBe('Sin título');
  });
});

describe('CommandExecutor', () => {
  const crearExecutor = (registro: ReturnType<typeof crearRegistroComandos>) =>
    new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

  it('devuelve COMMAND_NOT_FOUND cuando el tipo no esta registrado', async () => {
    const registro = crearRegistroComandos();
    const executor = crearExecutor(registro);
    const resultado = await executor.execute('comando.inexistente', {});
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('COMMAND_NOT_FOUND');
    expect(resultado.error?.message).toContain('Comando no registrado');
  });

  it('devuelve VALIDATION_FAILED cuando la validacion custom del comando falla', async () => {
    const registro = crearRegistroComandos();
    registro.register({
      type: 'test.validateFail',
      description: 'Comando que falla validacion',
      risk: 'write',
      validate: () => ({ valid: false, errors: [{ code: 'TEST_ERROR', message: 'Error de prueba' }], warnings: [] }),
      handler: () => ({ state: crearEstadoInicial(), events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    const resultado = await executor.execute('test.validateFail', {});
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('VALIDATION_FAILED');
    expect(resultado.error?.message).toContain('Error de prueba');
  });

  it('devuelve EXECUTION_ERROR cuando el handler lanza una excepcion', async () => {
    const registro = crearRegistroComandos();
    registro.register({
      type: 'test.execFail',
      description: 'Comando que lanza error',
      risk: 'write',
      handler: () => {
        throw new Error('Fallo en ejecucion');
      },
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    const resultado = await executor.execute('test.execFail', {});
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('EXECUTION_ERROR');
    expect(resultado.error?.message).toBe('Fallo en ejecucion');
  });

  it('undo revierte el estado cuando existe comando inverso', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.changeName',
      description: 'Cambia nombre',
      risk: 'write',
      inverseType: 'test.undoChangeName',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Cambiado' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoChangeName',
      description: 'Revierte nombre',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    await executor.execute('test.changeName', {});
    expect(executor.obtenerEstado().project.nombre).toBe('Cambiado');
    expect(executor.canUndo()).toBe(true);

    const undoResult = await executor.undo();
    expect(undoResult?.success).toBe(true);
    expect(executor.obtenerEstado().project.nombre).toBe(estadoInicial);
    expect(executor.canUndo()).toBe(false);
  });

  it('redo reaplica el estado despues de undo', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.redoName',
      description: 'Cambia nombre para redo',
      risk: 'write',
      inverseType: 'test.undoRedoName',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Cambiado' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoRedoName',
      description: 'Revierte nombre para redo',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    await executor.execute('test.redoName', {});
    expect(executor.obtenerEstado().project.nombre).toBe('Cambiado');

    await executor.undo();
    expect(executor.obtenerEstado().project.nombre).toBe(estadoInicial);
    expect(executor.canRedo()).toBe(true);

    const redoResult = await executor.redo();
    expect(redoResult?.success).toBe(true);
    expect(executor.obtenerEstado().project.nombre).toBe('Cambiado');
    expect(executor.canRedo()).toBe(false);
  });

  it('batch hace rollback del estado si un comando falla', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.ok',
      description: 'Comando ok',
      risk: 'write',
      inverseType: 'test.undoOk',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Ok' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoOk',
      description: 'Undo ok',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.fail',
      description: 'Comando fallido',
      risk: 'write',
      handler: () => {
        throw new Error('Fallo en batch');
      },
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    const resultado = await executor.batch([
      { type: 'test.ok', payload: {} },
      { type: 'test.fail', payload: {} },
    ]);

    expect(resultado.success).toBe(false);
    expect(resultado.rolledBack).toBe(true);
    expect(resultado.results).toHaveLength(2);
    expect(resultado.results[0].success).toBe(true);
    expect(resultado.results[1].success).toBe(false);
    expect(executor.obtenerEstado().project.nombre).toBe(estadoInicial);
    expect(executor.canUndo()).toBe(false);
  });

  it('batch fallido restaura pila undo/redo', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.prev',
      description: 'Previo',
      risk: 'write',
      inverseType: 'test.undoPrev',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Prev' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoPrev',
      description: 'Undo previo',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.okBatch',
      description: 'Ok en batch',
      risk: 'write',
      inverseType: 'test.undoOkBatch',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Ok' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoOkBatch',
      description: 'Undo ok batch',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Prev' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.failBatch',
      description: 'Falla',
      risk: 'write',
      handler: () => {
        throw new Error('batch boom');
      },
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    await executor.execute('test.prev', {});
    expect(executor.canUndo()).toBe(true);

    const resultado = await executor.batch([
      { type: 'test.okBatch', payload: {} },
      { type: 'test.failBatch', payload: {} },
    ]);

    expect(resultado.rolledBack).toBe(true);
    expect(executor.obtenerEstado().project.nombre).toBe('Prev');
    expect(executor.canUndo()).toBe(true);
    const undo = await executor.undo();
    expect(undo.success).toBe(true);
    expect(executor.obtenerEstado().project.nombre).toBe(estadoInicial);
  });

  it('undo fallido no mueve la pila', async () => {
    const registro = crearRegistroComandos();

    registro.register({
      type: 'test.fragile',
      description: 'Fragile',
      risk: 'write',
      inverseType: 'test.undoFragile',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Fragile' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoFragile',
      description: 'Undo fragile que falla',
      risk: 'write',
      handler: () => {
        throw new Error('undo boom');
      },
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    await executor.execute('test.fragile', {});
    expect(executor.canUndo()).toBe(true);
    expect(executor.canRedo()).toBe(false);

    const undo = await executor.undo();
    expect(undo.success).toBe(false);
    expect(executor.canUndo()).toBe(true);
    expect(executor.canRedo()).toBe(false);
    expect(executor.obtenerEstado().project.nombre).toBe('Fragile');
  });

  it('canUndo y canRedo reflejan el estado de las pilas', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.can',
      description: 'Test canUndo/canRedo',
      risk: 'write',
      inverseType: 'test.undoCan',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'X' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoCan',
      description: 'Undo can',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    expect(executor.canUndo()).toBe(false);
    expect(executor.canRedo()).toBe(false);

    await executor.execute('test.can', {});
    expect(executor.canUndo()).toBe(true);
    expect(executor.canRedo()).toBe(false);

    await executor.undo();
    expect(executor.canUndo()).toBe(false);
    expect(executor.canRedo()).toBe(true);

    await executor.redo();
    expect(executor.canUndo()).toBe(true);
    expect(executor.canRedo()).toBe(false);
  });

  it('getHistory devuelve una copia del historial de comandos exitosos', async () => {
    const registro = crearRegistroComandos();
    registrarComandosBuiltin(registro);
    const executor = crearExecutor(registro);

    await executor.execute('project.new', { nombre: 'Historia 1' });
    await executor.execute('project.new', { nombre: 'Historia 2' });

    const historia = executor.getHistory();
    expect(historia).toHaveLength(2);
    expect(historia[0].commandType).toBe('project.new');
    expect(historia[1].commandType).toBe('project.new');
    expect(historia[0].success).toBe(true);

    historia.push({ id: 'fake', commandType: 'fake', payload: null, timestamp: 0, source: 'user', success: true } as any);
    expect(executor.getHistory()).toHaveLength(2);
  });

  it('marcarBoundary limpia la pila de redo', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.boundary',
      description: 'Test boundary',
      risk: 'write',
      inverseType: 'test.undoBoundary',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'Cambiado' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoBoundary',
      description: 'Undo boundary',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    await executor.execute('test.boundary', {});
    await executor.undo();
    expect(executor.canRedo()).toBe(true);

    executor.marcarBoundary();
    expect(executor.canRedo()).toBe(false);
  });
});

describe('Schema Validation', () => {
  const crearExecutor = (registro: ReturnType<typeof crearRegistroComandos>) =>
    new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

  it('rechaza payload con campo requerido faltante', async () => {
    const registro = crearRegistroComandos();
    registro.register({
      type: 'test.schemaRequired',
      description: 'Comando con schema que requiere campo',
      risk: 'write',
      schema: {
        type: 'object',
        properties: { nombre: { type: 'string' } },
        required: ['nombre'],
        additionalProperties: false,
      },
      handler: (s: DAWState) => ({ state: s, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    const resultado = await executor.execute('test.schemaRequired', {});
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('VALIDATION_FAILED');
    expect(resultado.error?.message).toContain('Campo requerido faltante: nombre');
  });

  it('rechaza payload con tipo de campo incorrecto', async () => {
    const registro = crearRegistroComandos();
    registro.register({
      type: 'test.schemaType',
      description: 'Comando con schema de tipos',
      risk: 'write',
      schema: {
        type: 'object',
        properties: { volumen: { type: 'number' } },
        required: ['volumen'],
      },
      handler: (s: DAWState) => ({ state: s, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    const resultado = await executor.execute('test.schemaType', { volumen: 'no-es-number' });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('VALIDATION_FAILED');
    expect(resultado.error?.message).toContain("Campo 'volumen' debe ser number");
  });

  it('rechaza payload con propiedades no permitidas', async () => {
    const registro = crearRegistroComandos();
    registro.register({
      type: 'test.schemaExtra',
      description: 'Comando sin propiedades extra',
      risk: 'write',
      schema: {
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: false,
      },
      handler: (s: DAWState) => ({ state: s, events: [], result: null }),
    } as CommandDefinition);

    const executor = crearExecutor(registro);
    const resultado = await executor.execute('test.schemaExtra', { id: 'ok', field: 'extra' });
    expect(resultado.success).toBe(false);
    expect(resultado.error?.code).toBe('VALIDATION_FAILED');
    expect(resultado.error?.message).toContain('Propiedad no permitida: field');
  });
});

describe('Audit Log', () => {
  it('registra ejecuciones exitosas en el audit log', async () => {
    const registro = crearRegistroComandos();
    const auditoria = crearRegistroAuditoria();
    registrarComandosBuiltin(registro);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria,
      estadoInicial: crearEstadoInicial(),
    });

    await executor.execute('project.new', { nombre: 'Audit Test' });
    const entradas = auditoria.list();
    expect(entradas.length).toBeGreaterThan(0);
    expect(entradas[entradas.length - 1].commandType).toBe('project.new');
    expect(entradas[entradas.length - 1].result).toBe('success');
  });

  it('registra ejecuciones fallidas en el audit log', async () => {
    const registro = crearRegistroComandos();
    const auditoria = crearRegistroAuditoria();

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria,
      estadoInicial: crearEstadoInicial(),
    });

    await executor.execute('comando.inexistente', {});
    const entradas = auditoria.list();
    expect(entradas.length).toBeGreaterThan(0);
    expect(entradas[entradas.length - 1].result).toBe('failure');
    expect(entradas[entradas.length - 1].error).toContain('Comando no registrado');
  });
});

describe('Comandos Irreversibles', () => {
  it('comando sin inverseType no se agrega al undo stack', async () => {
    const registro = crearRegistroComandos();
    registro.register({
      type: 'test.irreversible',
      description: 'Comando sin inverso',
      risk: 'write',
      handler: (s: DAWState) => ({ state: s, events: [], result: null }),
    } as CommandDefinition);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    await executor.execute('test.irreversible', {});
    expect(executor.canUndo()).toBe(false);
  });

  it('batch exitoso ejecuta todos los comandos y refleja estado final', async () => {
    const registro = crearRegistroComandos();
    const estadoInicial = crearEstadoInicial().project.nombre;

    registro.register({
      type: 'test.batchA',
      description: 'Batch paso A',
      risk: 'write',
      inverseType: 'test.undoBatchA',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'A' } } as DAWState, events: [], result: 'A' }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoBatchA',
      description: 'Undo batch A',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: estadoInicial } } as DAWState, events: [], result: null }),
    } as CommandDefinition);
    registro.register({
      type: 'test.batchB',
      description: 'Batch paso B',
      risk: 'write',
      inverseType: 'test.undoBatchB',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'B' } } as DAWState, events: [], result: 'B' }),
    } as CommandDefinition);
    registro.register({
      type: 'test.undoBatchB',
      description: 'Undo batch B',
      risk: 'write',
      handler: (s: DAWState) => ({ state: { ...s, project: { ...s.project, nombre: 'A' } } as DAWState, events: [], result: null }),
    } as CommandDefinition);

    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });
    const resultado = await executor.batch([
      { type: 'test.batchA', payload: {} },
      { type: 'test.batchB', payload: {} },
    ]);

    expect(resultado.success).toBe(true);
    expect(resultado.rolledBack).toBe(false);
    expect(resultado.results).toHaveLength(2);
    expect(resultado.results[0].success).toBe(true);
    expect(resultado.results[1].success).toBe(true);
    expect(executor.obtenerEstado().project.nombre).toBe('B');
  });
});

describe('project.save persiste ruta y nombre', () => {
  it('deja ruta, nombre del archivo y modificado=false tras guardar', async () => {
    const { configurarFileService } = await import('../commands/project-commands');
    const { FileServiceMemoria } = await import('../project/persistencia');
    const registro = crearRegistroComandos();
    registrarComandosBuiltin(registro);
    configurarFileService(new FileServiceMemoria());
    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    const upd = await executor.execute('project.update', { datos: { ruta: 'C:/tmp/Balada PSR.jaswave' } });
    expect(upd.success).toBe(true);
    expect(executor.obtenerEstado().project.ruta).toBe('C:/tmp/Balada PSR.jaswave');

    const saved = await executor.execute('project.save', {});
    expect(saved.success).toBe(true);
    const project = executor.obtenerEstado().project;
    expect(project.ruta).toBe('C:/tmp/Balada PSR.jaswave');
    expect(project.nombre).toBe('Balada PSR');
    expect(project.modificado).toBe(false);
  });
});

describe('track.move', () => {
  it('reordena pistas y soporta undo', async () => {
    const registro = crearRegistroComandos();
    registrarComandosBuiltin(registro);
    const executor = new CommandExecutor({
      busEventos: new BusEventosMemoria({ capacidadBufferReplay: 100, tamanoBatch: 10 }),
      pila: crearPilaDeshacerRehacer(100),
      registro,
      auditoria: crearRegistroAuditoria(),
      estadoInicial: crearEstadoInicial(),
    });

    await executor.execute('track.create', { nombre: 'A', tipo: 'audio' });
    await executor.execute('track.create', { nombre: 'B', tipo: 'audio' });
    await executor.execute('track.create', { nombre: 'C', tipo: 'audio' });
    const ids = executor.obtenerEstado().project.tracks.map((t) => t.nombre);
    expect(ids).toEqual(['A', 'B', 'C']);

    const firstId = executor.obtenerEstado().project.tracks[0]!.id;
    const moved = await executor.execute('track.move', { trackId: firstId, toIndex: 2 });
    expect(moved.success).toBe(true);
    expect(executor.obtenerEstado().project.tracks.map((t) => t.nombre)).toEqual(['B', 'C', 'A']);
    expect(executor.obtenerEstado().project.tracks.map((t) => t.orden)).toEqual([0, 1, 2]);

    await executor.undo();
    expect(executor.obtenerEstado().project.tracks.map((t) => t.nombre)).toEqual(['A', 'B', 'C']);
  });
});
