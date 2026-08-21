/**
 * Buffer circular de replay de eventos de dominio.
 *
 * Propósito:
 *   Almacenar una ventana acotada de eventos emitidos por el BusEventos
 *   para permitir su recuperación, filtrado y reconstrucción posterior
 *   del estado del sistema.
 *
 * Importancia:
 *   - Habilita funcionalidades como replay de sesiones, depuración avanzada
 *     y auditoría del flujo de usuario.
 *   - Limita automáticamente el consumo de memoria descartando eventos
 *     antiguos cuando se supera la capacidad configurada.
 *   - Permite filtrar por nombre, fuente o marca de tiempo, facilitando
 *     la consulta selectiva de eventos relevantes.
 *
 * Función:
 *   Implementa una estructura FIFO con capacidad máxima que almacena
 *   EventoDominio completos y expone métodos para agregar, consultar
 *   con filtros opcionales y limpiar el buffer.
 */

import type { EventoDominio, FiltroEvento } from './evento-dominio';

export class BufferReplay {
  private eventos: EventoDominio[] = [];
  private capacidad: number;

  constructor(capacidad: number = 2000) {
    this.capacidad = capacidad;
  }

  agregar(evento: EventoDominio): void {
    if (this.eventos.length >= this.capacidad) {
      this.eventos.shift();
    }
    this.eventos.push(evento);
  }

  obtenerEventos(filtro?: FiltroEvento): EventoDominio[] {
    let resultado = this.eventos;
    if (filtro?.nombre) {
      resultado = resultado.filter(e => e.nombre === filtro.nombre);
    }
    if (filtro?.fuente) {
      resultado = resultado.filter(e => e.fuente === filtro.fuente);
    }
    if (filtro?.desde) {
      resultado = resultado.filter(e => e.marcaTiempo >= filtro.desde!);
    }
    if (filtro?.limite) {
      resultado = resultado.slice(-filtro.limite);
    }
    return resultado;
  }

  limpiar(): void {
    this.eventos = [];
  }
}
