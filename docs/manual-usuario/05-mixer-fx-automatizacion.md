# 05 · Mixer, FX y automatización

## Mixer

Cada tira (strip) muestra:

- Nombre (arrastra **⋮⋮** para reordenar)
- Mute / Solo / Monitor / Arm
- Fader de volumen + medidor
- Paneo
- Sends a buses (hasta knobs MVP)
- Banco FX compacto

**Master** está al final: volumen global y FX de master.

### Acciones rápidas

- **Automezcla** — balancea volúmenes/paneos de forma automática
- **Aleatorizar** — variación creativa de niveles (úsalo con undo a mano)

## FX Chain

1. Selecciona pista → panel **FX Chain** (o desde Inspector / cabecera).
2. **+ Add FX** — instrumento o efecto del catálogo.
3. Orden: arrastra plugins en la cadena (comando interno `plugin.move`).
4. **Bypass** por plugin sin descargarlo.
5. Abre **Editor de plugin** para la UI nativa.
6. Copia/pega cadenas entre pistas; guarda preset FX global si lo ofrece la UI.

### Orden típico

```
Instrumento (VST) → EQ → Comp → Saturación → (sends a Reverb/Delay)
```

En pistas de audio: sin instrumento, solo FX.

## Sends / buses

1. Crea un bus FX (el Asistente puede hacer `bus.create`, o desde routing).
2. En el Mixer, sube el **send** de cada pista hacia ese bus.
3. En el bus: carga Reverb/Delay y deja el fader del bus como retorno.

Los sends se escuchan en **Play** y se respetan en el **bounce** (cadena nativa).

## Sidechain

En 1.0 el sidechain **no es audible** en el host (solo estado/meter).  
Para ducking real: usa un compresor VST con sidechain propio del plugin, o espera post-1.0.

## Freeze / Unfreeze

En el **Inspector** de pista:

1. **Freeze** — bounce de esa pista a audio, bypass de plugins, sustituye MIDI por clip.
2. **Unfreeze** — reactiva plugins restaurando el bypass que tenías antes del freeze.

Úsalo con Kontakt/BFD pesados cuando ya no editas MIDI.

## Automatización

1. Abre lanes de automatización (panel / mixer).
2. Activa **Write** (arm de escritura).
3. En Play, mueve fader o pan → se graban puntos.
4. Parámetros de plugin: lanes delgadas / runtime (MVP).

Para curvas exactas, el Asistente puede usar `automation.setCurve`.

Siguiente: [06 · Piano roll y MIDI](./06-piano-roll-y-midi.md).
