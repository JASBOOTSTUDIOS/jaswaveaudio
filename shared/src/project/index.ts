export { proyectoNuevo, validarNombre, validarExtensionRuta, proyectoParaGuardar, archivoValido, FORMATO_ACTUAL, validarIntegridadProyecto, reconstruirRouting, verificarReferenciasAudio, esNombreSinTitulo, nombreDesdeRuta, nombreAlGuardar } from './ciclo-vida';
export type { AudioReference, ProyectoArchivo } from './ciclo-vida';
export { guardarProyecto, cargarProyecto, cargarProyectoConRespaldo, rutaRespaldo, ErrorCargaProyecto, FileService, FileServiceMemoria } from './persistencia';
export type { CodigoErrorCarga, OpcionesCargaProyecto, ResultadoCargaConRespaldo } from './persistencia';
export { migrarArchivo, mensajeVersionFutura, MIGRACIONES_ARCHIVO } from './migraciones-archivo';
export type { MigracionArchivo, ArchivoCrudo, ResultadoMigracionArchivo } from './migraciones-archivo';
export * from '../schemas/proyecto';
export { esNotaMidiValida, repararNotasMidi } from './reparar-notas';
