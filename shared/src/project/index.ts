export { proyectoNuevo, validarNombre, validarExtensionRuta, proyectoParaGuardar, archivoValido, FORMATO_ACTUAL, validarIntegridadProyecto, reconstruirRouting, verificarReferenciasAudio, referenciasAudioFaltantes, unirRuta, normalizarRutaRelativa, esRutaMediaRelativa, formatoAudioDesdeRuta, nombreArchivoMedia, MEDIA_REL_DIR, MEDIA_PENDING_REL_DIR, MEDIA_RECORDINGS_REL_DIR, esNombreSinTitulo, nombreDesdeRuta, nombreAlGuardar } from './ciclo-vida';
export type { AudioReference, FormatoAudioReferencia, ProyectoArchivo } from './ciclo-vida';
export { guardarProyecto, cargarProyecto, cargarProyectoConRespaldo, rutaRespaldo, carpetaDeRuta, ErrorCargaProyecto, FileService, FileServiceMemoria } from './persistencia';
export type { CodigoErrorCarga, OpcionesCargaProyecto, ResultadoCargaConRespaldo } from './persistencia';
export { migrarArchivo, mensajeVersionFutura, MIGRACIONES_ARCHIVO } from './migraciones-archivo';
export type { MigracionArchivo, ArchivoCrudo, ResultadoMigracionArchivo } from './migraciones-archivo';
export * from '../schemas/proyecto';
export { esNotaMidiValida, repararNotasMidi } from './reparar-notas';
