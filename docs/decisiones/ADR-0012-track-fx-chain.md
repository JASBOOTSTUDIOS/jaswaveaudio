# ADR-0012: FX Chain por pista (Track inserts)

## Estado

**Aprobado** · Dominio/UI/AI de cadena **hechos**. DSP de inserts serial estilo Reaper **hecho** ([ADR-0013](./ADR-0013-fx-runtime-pipeline.md) R2/R3). **Sends live en host `renderMix` OK (1.0).** Sidechain I/O a plugins **diferido post-1.0** (solo meter/estado). Compensación de latencia fina pendiente.

Complementa [ADR-0011](./ADR-0011-plugin-host-vst3.md) y [021-fx-chains](../hoja-ruta/021-fx-chains.md).

## Contexto

Cadena FX estilo Reaper **por pista** (+ Master), integrada con Plugin Host, Command System, Mixer, Inspector e IA.

## Decisión

1. **Una sola cadena**: `track.plugins` y `project.master.plugins` (trackId canónico `master`).
2. **Hosting vs dominio**: `PluginInfo` = metadato lógico; runtime en Plugin Host. React nunca carga VST.
3. **Instrumento vs efecto**: `PluginInfo.tipo` / `categoria`.
4. **Comandos**:
   - `plugin.insert|remove|move|bypass|duplicate|replace|setParameter`
   - `fxChain.copy|paste|pasteUndo|savePreset|loadPreset`
5. **Automatización**: clave `plugin:{instanceId}:{parameterId}` (`automationParamKey`).
6. **UI**: tool `fx-chain` + strip pista/mixer/Master + editor nativo.
7. **AI**: ACTIONS del agente + `registrarPluginTools` en Tool Registry.
8. **Placement**: el clip no tiene FX propios; al cambiar `trackId` el media pasa por la cadena de la pista destino (comportamiento Reaper; DSP inserts = ADR-0013).

## Hecho / pendiente

| Ítem | Estado |
|------|--------|
| Domain FX Chain + Master | Hecho |
| Replace / copy-paste / presets | Hecho |
| setParameter + automation key | Hecho |
| AI ACTIONS plugin.* | Hecho |
| Instrument VST playback | Hecho (misma instancia UI+audio; Soft Pad insertable) |
| Cadena de **efectos** audio en engine | Hecho — serial por pista + master (stems JWST); sin sends |
| Clip → pista en Play | Hecho (reprogramación al mover / cambiar trackId) |
| Sidechain / sends runtime | Preparado en tipos; cableado UI pendiente |
| Hot-swap atómico audio thread | Pendiente ADR-0011 |

## No hacer

- Sistema FX paralelo.
- Mutar `plugins` desde React sin CommandExecutor.
- Cargar DLL desde Renderer.
