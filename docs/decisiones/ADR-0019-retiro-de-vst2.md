# ADR-0019: Retiro de VST2

**Estado:** aceptada · **Fecha:** 2026-10-26 · **Sustituye a:** [ADR-0018](ADR-0018-soporte-vst2-se-mantiene.md)
**Decide:** JASBOOTSTUDIOS (propietario). El commit `b139db1` ya retiró el soporte en el código; este ADR deja constancia
de la decisión y cierra los restos.

## Contexto

ADR-0018 (2026-10-19) mantenía el soporte VST2 en el host nativo aceptando un riesgo legal residual (el VST2 SDK de
Steinberg ya no se licencia). El plan maestro posterior fijó **VST3 de 64 bits como único formato**: menos superficie de
fallos dentro del proceso del host (los VST2 cargan una DLL arbitraria cuyo `DllMain` y su hilo de audio no se pueden
aislar), un SDK con licencia MIT y una experiencia de plugins homogénea (parámetros normalizados, estado, editor
embebido).

## Decisión

1. JasWave **solo carga plugins `.vst3` de 64 bits**. No se escanean ni se cargan `.dll` VST2.
2. El host nativo rechaza cualquier ruta que no termine en `.vst3` en `ensureSlotLoaded`, no solo en el comando `load`
   del bridge: un `openEditor` con un slot no cargado ya no puede cargar una DLL VST2 (ejecutaría su `DllMain` en el
   proceso del host).
3. Se eliminan: `native/plugin-host/vendor/vst2/aeffect.h`, `skipVst2DllName`, `HostedSlot::pathLooksVst2`, las rutas de
   búsqueda VST2 por defecto, las concesiones de acceso a carpetas VST2 y los textos de UI y documentación que
   anunciaban compatibilidad.
4. Los proyectos que referencian un `.dll` VST2 siguen abriéndose: el plugin se muestra como no soportado
   (`Vst2Deprecated` / `VST2_NOT_HOSTED_MSG`) con la indicación de migrar a la edición VST3. El estado binario del
   VST2 no se puede convertir y se conserva en el proyecto sin cargarse.

## Consecuencias

- Los usuarios con bibliotecas VST2 sin versión VST3 no podrán usarlas (se puede valorar un bridge externo en el
  futuro; fuera de alcance).
- Desaparece el riesgo legal residual de la cabecera `aeffect.h`.
- El tipo `format: 'vst2'` se mantiene en los tipos TypeScript solo para identificar y rechazar entradas heredadas.
