/**
 * Punto de entrada público del paquete @jaswave/shared.
 *
 * Propósito:
 *   Centralizar y exponer todos los contratos, tipos, constantes y servicios
 *   compartidos del dominio JasWave en una única importación para los
 *   módulos consumidores.
 *
 * Importancia:
 *   - Evita imports relativos profundos y fragilidad ante refactorizaciones.
 *   - Establece la superficie de API pública oficial del paquete shared,
 *     funcionando como contrato entre equipos y módulos.
 *   - Facilita el tree-shaking y la documentación automática al agrupar
 *     exports nombrados.
 *
 * Función:
 *   Re-exporta tipos, constantes de eventos, interfaces de dominio,
 *   implementaciones del bus de eventos y utilidades de buffer/replay
 *   desde sus módulos internos.
 */

export * from './types';
export * from './state';
export * from './constants/nombres-eventos';
export * from './events/evento-dominio';
export * from './events/event-bus';
export * from './events/buffer-replay';
export * from './events/suscripcion';
export * from './events/schemas-eventos';
export * from './events/ciclo-vida-suscripciones';
export * from './ai';
export * as explorador from './explorador';
export { ACCIONES_ATAJO, ATAJOS_POR_DEFECTO } from './config/atajos';
export type { AccionAtajo } from './config/atajos';
export { RegistroAcciones, crearRegistroAcciones } from './config/action-registry';
export type { ManejadorAccion, DefinicionAccion } from './config/action-registry';
export { DespachadorTeclado, crearDespachador, normalizarEventoTeclado } from './config/keyboard-dispatcher';
export * from './actions';
export * from './midi';
