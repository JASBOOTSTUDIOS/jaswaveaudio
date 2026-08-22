# ADR-0012: FX Chain por pista (Track inserts)

## Estado

**Aprobado** · Fases dominio/UI/AI avanzadas (audio DSP multi-FX en host sigue parcial).

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

## Hecho / pendiente

| Ítem | Estado |
|------|--------|
| Domain FX Chain + Master | Hecho |
| Replace / copy-paste / presets | Hecho |
| setParameter + automation key | Hecho |
| AI ACTIONS plugin.* | Hecho |
| Instrument VST playback | Hecho (host OOP) |
| Cadena de **efectos** audio en engine | Parcial / siguiente |
| Sidechain / sends runtime | Preparado en tipos; cableado UI pendiente |
| Hot-swap atómico audio thread | Pendiente ADR-0011 |

## No hacer

- Sistema FX paralelo.
- Mutar `plugins` desde React sin CommandExecutor.
- Cargar DLL desde Renderer.
