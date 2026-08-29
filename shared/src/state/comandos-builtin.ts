
import type { EventoDominio } from '../events/evento-dominio';
import type { CommandDefinition, CommandRegistry } from '../types/command';
import {
  crearComandoProjectNew,
  crearComandoProjectSave,
  crearComandoProjectLoad,
  crearComandoProjectClose,
} from '../commands/project-commands';
import {
  crearComandoAtajoListar,
  crearComandoAtajoActualizar,
  crearComandoAtajoRestaurar,
  crearComandoAtajoRestaurarUno,
  crearComandoAtajoEjecutar,
} from '../commands/atajos-commands';
import {
  crearComandoTrackCreate,
  crearComandoTrackDelete,
  crearComandoTrackMove,
  crearComandoTrackRestore,
  crearComandoTrackUpdate,
  crearComandoTrackToggleMute,
  crearComandoTrackToggleSolo,
  crearComandoTrackToggleArm,
  crearComandoTrackToggleMonitor,
  crearComandoClipCreate,
  crearComandoMidiClipCreate,
  crearComandoMidiNotesSet,
  crearComandoMidiTranspose,
  crearComandoMidiQuantize,
  crearComandoMidiHumanize,
  crearComandoMidiSetVelocity,
  crearComandoMidiDeleteNotes,
  crearComandoMidiCreateNotes,
  crearComandoMidiMakeStaccato,
  crearComandoMidiMakeLegato,
  crearComandoMidiRepeat,
  crearComandoMidiReverse,
  crearComandoMidiInvert,
  crearComandoMidiTimeStretch,
  crearComandoMidiConstrainScale,
  crearComandoMidiGenerate,
  crearComandoMidiApplyGroove,
  crearComandoMidiSetCc,
  crearComandoMidiSetPitchBend,
  crearComandoClipDelete,
  crearComandoClipRestore,
  crearComandoClipMove,
  crearComandoClipResize,
  crearComandoClipSplit,
  crearComandoTransportToggle,
  crearComandoTransportStop,
  crearComandoTransportSeek,
  crearComandoTransportToggleLoop,
  crearComandoTransportToggleMetronome,
  crearComandoTransportToggleRecord,
  crearComandoTransportTogglePunch,
  crearComandoTransportToggleCountIn,
  crearComandoProjectSetBpm,
} from '../commands/domain-commands';
import {
  crearComandoMasterUpdate,
  crearComandoSetTimeSignature,
  crearComandoSetTool,
  crearComandoTogglePanel,
  crearComandoSetSnap,
  crearComandoSetZoom,
  crearComandoMarkerCreate,
  crearComandoProjectUpdate,
} from '../commands/auxiliary-commands';
import {
  crearComandoSelectionSet,
  crearComandoSelectionClear,
  crearComandoUiSetPalette,
} from '../commands/selection-commands';
import {
  crearComandoPluginInsert,
  crearComandoPluginRemove,
  crearComandoPluginMove,
  crearComandoPluginBypass,
  crearComandoPluginDuplicate,
  crearComandoPluginReplace,
  crearComandoPluginSetParameter,
  crearComandoFxChainCopy,
  crearComandoFxChainPaste,
  crearComandoFxChainPasteUndo,
  crearComandoFxChainLoadPreset,
  crearComandoFxChainSavePreset,
} from '../commands/plugin-commands';
import {
  crearComandoRenderStart,
  crearComandoRenderCancel,
  crearComandoRenderGetStatus,
} from '../commands/render-commands';
import {
  crearComandoAnalysisLoudness,
  crearComandoAnalysisCompareTarget,
  crearComandoAnalysisSpectrum,
  crearComandoAnalysisStereo,
  crearComandoAnalysisFullReport,
} from '../commands/analysis-commands';
import {
  crearComandoAutomationSetCurve,
  crearComandoAutomationClear,
  crearComandoAutomationWritePoint,
} from '../commands/automation-commands';
import {
  crearComandoBusCreate,
  crearComandoSendSet,
  crearComandoSidechainConnect,
} from '../commands/routing-commands';
import {
  crearComandoTrackFreeze,
  crearComandoTrackUnfreeze,
} from '../commands/freeze-commands';

/**
 * Crea un evento de dominio estandarizado para el bus.
 *
 * @param nombre - Nombre del evento (ej. `project.created`).
 * @param payload - Datos del evento.
 * @returns Evento de dominio listo para emitir.
 */
function evento(nombre: string, payload: Record<string, unknown>): EventoDominio {
  return {
    nombre,
    version: 1,
    marcaTiempo: Date.now(),
    fuente: 'builtin',
    payload: payload as any,
  };
}

/**
 * Registra una definición de comando en el registry dado.
 *
 * @param cmd - Definición del comando a registrar.
 * @param registry - Registry destino.
 */
function registrar(cmd: CommandDefinition<any>, registry: CommandRegistry): void {
  registry.register(cmd);
}

/**
 * Registra todos los comandos built-in del dominio en el registry.
 *
 * Incluye comandos de proyecto, tracks, clips, transporte y atajos.
 * Debe llamarse al inicializar la aplicación para poblar el registry global.
 *
 * @param registry - Registry donde se registrarán los comandos.
 */
export function registrarComandosBuiltin(registry: CommandRegistry): void {
  registrar(crearComandoProjectNew(), registry);
  registrar(crearComandoProjectSave(), registry);
  registrar(crearComandoProjectLoad(), registry);
  registrar(crearComandoProjectClose(), registry);
  registrar(crearComandoProjectSetBpm(), registry);
  registrar(crearComandoTrackCreate(), registry);
  registrar(crearComandoTrackDelete(), registry);
  registrar(crearComandoTrackMove(), registry);
  registrar(crearComandoTrackRestore(), registry);
  registrar(crearComandoTrackUpdate(), registry);
  registrar(crearComandoTrackToggleMute(), registry);
  registrar(crearComandoTrackToggleSolo(), registry);
  registrar(crearComandoTrackToggleArm(), registry);
  registrar(crearComandoTrackToggleMonitor(), registry);
  registrar(crearComandoClipCreate(), registry);
  registrar(crearComandoMidiClipCreate(), registry);
  registrar(crearComandoMidiNotesSet(), registry);
  registrar(crearComandoMidiTranspose(), registry);
  registrar(crearComandoMidiQuantize(), registry);
  registrar(crearComandoMidiHumanize(), registry);
  registrar(crearComandoMidiSetVelocity(), registry);
  registrar(crearComandoMidiDeleteNotes(), registry);
  registrar(crearComandoMidiCreateNotes(), registry);
  registrar(crearComandoMidiMakeStaccato(), registry);
  registrar(crearComandoMidiMakeLegato(), registry);
  registrar(crearComandoMidiRepeat(), registry);
  registrar(crearComandoMidiReverse(), registry);
  registrar(crearComandoMidiInvert(), registry);
  registrar(crearComandoMidiTimeStretch(), registry);
  registrar(crearComandoMidiConstrainScale(), registry);
  registrar(crearComandoMidiGenerate(), registry);
  registrar(crearComandoMidiApplyGroove(), registry);
  registrar(crearComandoMidiSetCc(), registry);
  registrar(crearComandoMidiSetPitchBend(), registry);
  registrar(crearComandoClipDelete(), registry);
  registrar(crearComandoClipRestore(), registry);
  registrar(crearComandoClipMove(), registry);
  registrar(crearComandoClipResize(), registry);
  registrar(crearComandoClipSplit(), registry);
  registrar(crearComandoTransportToggle(), registry);
  registrar(crearComandoTransportStop(), registry);
  registrar(crearComandoTransportSeek(), registry);
  registrar(crearComandoTransportToggleLoop(), registry);
  registrar(crearComandoTransportToggleMetronome(), registry);
  registrar(crearComandoTransportToggleRecord(), registry);
  registrar(crearComandoTransportTogglePunch(), registry);
  registrar(crearComandoTransportToggleCountIn(), registry);
  registrar(crearComandoAtajoListar(), registry);
  registrar(crearComandoAtajoActualizar(), registry);
  registrar(crearComandoAtajoRestaurar(), registry);
  registrar(crearComandoAtajoRestaurarUno(), registry);
  registrar(crearComandoAtajoEjecutar(), registry);
  registrar(crearComandoMasterUpdate(), registry);
  registrar(crearComandoSetTimeSignature(), registry);
  registrar(crearComandoSetTool(), registry);
  registrar(crearComandoTogglePanel(), registry);
  registrar(crearComandoSetSnap(), registry);
  registrar(crearComandoSetZoom(), registry);
  registrar(crearComandoMarkerCreate(), registry);
  registrar(crearComandoProjectUpdate(), registry);
  registrar(crearComandoSelectionSet(), registry);
  registrar(crearComandoSelectionClear(), registry);
  registrar(crearComandoUiSetPalette(), registry);
  registrar(crearComandoPluginInsert(), registry);
  registrar(crearComandoPluginRemove(), registry);
  registrar(crearComandoPluginMove(), registry);
  registrar(crearComandoPluginBypass(), registry);
  registrar(crearComandoPluginDuplicate(), registry);
  registrar(crearComandoPluginReplace(), registry);
  registrar(crearComandoPluginSetParameter(), registry);
  registrar(crearComandoFxChainCopy(), registry);
  registrar(crearComandoFxChainPaste(), registry);
  registrar(crearComandoFxChainPasteUndo(), registry);
  registrar(crearComandoFxChainLoadPreset(), registry);
  registrar(crearComandoFxChainSavePreset(), registry);
  registrar(crearComandoRenderStart(), registry);
  registrar(crearComandoRenderCancel(), registry);
  registrar(crearComandoRenderGetStatus(), registry);
  registrar(crearComandoAnalysisLoudness(), registry);
  registrar(crearComandoAnalysisCompareTarget(), registry);
  registrar(crearComandoAnalysisSpectrum(), registry);
  registrar(crearComandoAnalysisStereo(), registry);
  registrar(crearComandoAnalysisFullReport(), registry);
  registrar(crearComandoAutomationSetCurve(), registry);
  registrar(crearComandoAutomationClear(), registry);
  registrar(crearComandoAutomationWritePoint(), registry);
  registrar(crearComandoBusCreate(), registry);
  registrar(crearComandoSendSet(), registry);
  registrar(crearComandoSidechainConnect(), registry);
  registrar(crearComandoTrackFreeze(), registry);
  registrar(crearComandoTrackUnfreeze(), registry);
}
/**
 * Alias de `registrarComandosBuiltin` para registrar comandos de proyecto.
 *
 * @param registry - Registry donde se registrarán los comandos.
 */
export function registrarComandosProyecto(registry: CommandRegistry): void {
  registrarComandosBuiltin(registry);
}

/**
 * Registra un comando individual en el registry.
 *
 * @param cmd - Definición del comando a registrar.
 * @param registry - Registry destino.
 */
export function registrarComando(cmd: CommandDefinition<any>, registry: CommandRegistry): void {
  registrar(cmd, registry);
}
