# R — Legato worship (notas pisadas con pedal, sin huecos)

> Estado: implementado y probado con tests (sin modelo real, sin oído). Pendiente: una pasada real de la banda con un pedido de adoración.

## 1. Regla del usuario

«Ninguna nota se suelta hasta que el sonido cae, excepto con los pads que siempre suenan; el piano y los instrumentos no
dejan caer el sonido: las notas se dejan pisadas con el pedal y se sueltan 500 ms DESPUÉS de la siguiente, para no dejar
huecos en las melodías.»

Traducción: en una pista afinada (piano, guitarra, cuerdas, sintes, lead y también bajo) cada nota o acorde dura hasta
500 ms después del **inicio** de la siguiente nota/acorde de esa pista. Los pads sostienen hasta el siguiente acorde y se
solapan con él (1 s). Batería y percusión quedan fuera.

## 2. Algoritmo (`aplicarLegatoWorship`, `shared/src/music/legato-worship.ts`)

Función pura, en beats; los ms se convierten con el bpm (`ms · bpm / 60000`). No muta la entrada.

1. Se ignoran las notas con `mute`. El resto se agrupa en **eventos** por inicio (`tolAcorde` = 1/32 beat): un acorde es un evento.
2. Para cada evento con siguiente evento: `duración = max(duración original, siguienteInicio + solape − inicio)` para todas sus notas, sin pasar de `finClip`. Nunca se acorta por esto.
3. Hueco (`siguienteInicio − fin del evento`) mayor a `maxHuecoBeats` (8) = silencio intencional: no se puentea (salvo modo `pad`). `cortes` (límites de sección, opcional) nunca se cruzan, ni en modo pad.
4. El último evento conserva su duración; en modo `pad` con `finClip`, llega al fin del clip.
5. Una misma altura que vuelve a sonar antes de acabar se recorta 1/64 beat antes de su nueva entrada (sin notas pegadas ni reataques fantasma).
6. Devuelve `{ notas, resumen: { alargadas, huecosCerrados } }`. Es idempotente (probado).

`clasificarPistaLegato(nombre, plugins)` devuelve `bateria` (bater/drum/percus/kit), `pad` (pad, atmos, shimmer, ambient, ambiente) o `afinada`.

## 3. Dónde se aplica

| Dónde | Cómo |
|---|---|
| Banda virtual, al escribir | `plugins/com.jaswave.modulo.asistente-ia/src/motor/turno/legato-banda.ts`, enganchado en `turno-banda.ts` justo después de `guardarEscrituraArmonia` y antes de ejecutar. Actúa en `midi.clip.create`, `notes.set`, `createNotes`, `notes.add`, `notes.patch`. Solo si el pedido contiene worship/adoración/alabanza/balada/congregación; ajuste `localStorage['jaswave-banda-legato']` = `siempre` \| `worship` (defecto) \| `nunca`. El resultado lleva un aviso: «legato worship: N notas sostenidas hasta 500 ms después de la siguiente». |
| Pista o clip existente (usuario o IA) | Comando con undo `midi.notes.legatoWorship {pistaId, clipId?, solapeMs?, modo?}` (`shared/src/commands/domain-commands.ts`, reutiliza `applyMidiNotesToClip`, como `midi.makeLegato`). Sin `clipId` el agente de la app lo lanza por cada clip MIDI (un undo por clip). Rechaza la batería. Política: escritura. |
| Instrucción a los músicos | `INSTRUCCIONES_ROL.musico` (`ai-harness/src/agente/produccion.ts`) y habilidad de serie «Sostener como en worship» (`habilidades-agentes.ts`). |

Convivencia con la medición (`coherencia-banda.ts`): `analizarCoherencia` mide inicios (rejilla, «después del final») y
recorta la duración al clip, así que alargar duraciones no genera avisos de esos tipos; el fin se recorta a `finClip`. El
aviso de parte «cuadrada» cuenta duraciones distintas: el legato las diversifica, no las uniformiza (probado en `legato-banda.test.ts`).

## 4. Límites

- La guardia de la banda ve solo las notas de **esa** llamada: en `notes.add/patch` parciales no conoce las vecinas que ya hay en el clip. Para eso, `midi.notes.legatoWorship` mira el clip entero.
- No cruza clips: el último evento de cada clip conserva su duración (los pads, la llevan al fin del clip). La cola de un clip no se solapa con el primer acorde del siguiente.
- La detección worship es por palabras del pedido (no del estilo elegido en otra parte). El pad se detecta por el nombre de la pista o del plugin.
- **Pedal CC64 (opcional): NO implementado.** El render offline (`bounce-content.ts`) lee `clip.expression.cc`, pero la reproducción en vivo (`lib/midi-lookahead.ts` solo envía `ccs` si el clip los trae y nada los rellena desde `expression`) no los envía a los plugins; no se inventa soporte. El legato por duración consigue el mismo efecto audible. Si se añade, convendría un carril CC64 generado a partir de los mismos eventos (pisar al cambiar de acorde, soltar un instante después).

## 5. Qué validar con una pasada real

1. `/banda` con «canción de adoración lenta»: avisos «legato worship: …» en las escrituras de piano/guitarra/cuerdas/bajo/pads y ninguno en batería.
2. Oído: melodías sin huecos, sin notas pegadas ni reataques en notas repetidas; pads sin cortes.
3. Que el arreglista/QA no marque partes «robóticas» ni rejilla por culpa del cambio.
4. `midi.notes.legatoWorship` sobre una pista existente y Ctrl+Z.
