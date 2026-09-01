# 12 · Solución de problemas

## No hay sonido (Play)

1. Device correcto en Ajustes → Audio (¿otra app tiene ASIO exclusivo?).
2. Master y pistas no en mute; no hay solo de una pista vacía.
3. VSTs: ¿host listo? ¿preset en DecentSampler?
4. Buffer rojo → sube buffer size.
5. Reinicia Plugin Host / reaplica device (`ensureBest` vía Asistente o ajustes).

## MIDI sin audio

1. Instrumento en la cadena de esa pista.
2. Slot host confirmado (Music Build / insert fallan a propósito si no).
3. Tras crash/restart: espera resync; si sigue mudo, reinserta el VST.
4. Notas fuera de rango / pista equivocada.

## Bounce silencioso o error

1. Lee el mensaje: “VST sin slot host” → carga instrumentos y reintenta.
2. Clips de audio deben entrar en el render offline (host actualizado con `pull_stem`).
3. Comprueba rango de duración (segundos) en el diálogo.
4. Disco lleno / ruta de salida no escribible.

## FLAC/MP3 deshabilitados

Instala **ffmpeg** y asegúrate de que esté en el PATH del sistema; reinicia JasWave.

## Monitor de entrada no se oye

Con ASIO como dueño del device, el soft-monitor Chromium puede estar desactivado.  
Opciones: monitor hardware del interface, o WASAPI Shared para esa sesión de grabación.

## VST crashea / cuarentena

1. El DAW debe seguir vivo.
2. Ajustes → limpiar cuarentena tras actualizar el plugin.
3. Preferir VST3; VST2 solo x64.

## DecentSampler / “Descent” no carga

1. Confirma instalación en Common Files VST3.
2. Pide “DecentSampler” o “Descent” al Asistente (alias).
3. Abre UI y carga `.dspreset`.

## Asistente no aplica cambios

1. ¿Modo **Consulta** o **Plan** sin pulsar **Construir**?
2. ¿Permisos demasiado restrictivos en Ajustes?
3. ¿Proveedor IA caído (Ollama/offline)?

## Sidechain “no hace nada”

Correcto en 1.0: no hay I/O audible. Usa sidechain del propio VST o waits post-1.0.

## Rendimiento / xruns

1. Sube buffer ASIO.
2. Freeze pistas pesadas.
3. Cierra UIs nativas de VST que no uses.
4. Menos envíos / FX en serie larguísimos.

## Recuperación rápida

```text
(Al Asistente, modo Crear)
Revisa health del host, clearQuarantine si hace falta, ensureBest del device,
reasegura VSTs del proyecto y dime qué pistas siguen sin slot.
```

---

## Dónde pedir ayuda (docs técnicas)

- Checklist producto: `docs/CHECKLIST-PRODUCTO.md`
- Mezcla/master: `docs/ESTADO-MEZCLA-MASTERIZACION.md`
- Gaps de control IA: `docs/AGENT-CONTROL-GAPS.md`

Fin del manual — vuelve al [índice](./README.md).
