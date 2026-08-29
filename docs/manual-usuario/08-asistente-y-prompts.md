# 08 · Asistente Jas y prompts

El **Asistente Jas** es el copiloto del DAW: lee el proyecto, propone cambios y (según el modo) los aplica con undo.

## Modos

| Modo UI | Cuándo usarlo |
|---------|----------------|
| **Auto** | Dejas que elija por tu texto |
| **Consulta** | Preguntas; **no muta** el proyecto |
| **Plan** | Escribe `plan.md` / preview; tú pulsas **Construir** |
| **Pensar** | Arreglo profundo + preview Music Build (`aplicar: false`) |
| **Crear** | Ejecuta al vuelo + reparación (harness) |

### Flujo seguro (recomendado al empezar)

1. **Plan** o **Pensar** → revisa diff / tarjeta Music Build.
2. **Construir** (acepta/rechaza acciones si aparecen cards).
3. Escucha → ajusta a mano → pide refinements en **Crear** o **Consulta**.

### Flujo rápido

**Crear** + un prompt claro de Music Build (abajo).

## Mentions `@`

En el chat puedes `@` pista, plugin o mensaje previo para anclar contexto.

## Docs y plan.md

- Panel **Docs**: edita `plan.md` (Intención, Por implementar, Evaluación…).
- El Asistente actualiza secciones; tú también puedes editar a mano.
- Tras bounce, la evaluación puede incluir el informe de escucha (LUFS / listen).

## Music Build

Orquestador interno (`daw.musicBuild`):

1. Spec (BPM, tonalidad, secciones, roles)
2. Pistas + instrumentos del **catálogo** (o Roles)
3. MIDI validado
4. Mezcla básica (vol/pan, a veces bus reverb)

**No uses** “genera una canción MIDI en una sola pista” si quieres un proyecto multi-pista: pide explícitamente **Music Build** / proyecto completo.

Si un VST no carga en el host, el build **falla con mensaje claro** (no silencio silencioso).

---

## Prompts recomendados

Copia, adapta género/BPM/tonalidad.

### Consulta

```text
Resume el proyecto: BPM, tonalidad si la hay, pistas, qué VSTs están cargados y si hay clips vacíos.
```

```text
¿Qué pista está en solo o mute? ¿Hay algo que explique silencio en el master?
```

### Plan

```text
Haz un plan para una canción indie folk de 2 minutos en G mayor a 96 BPM.
Secciones: Intro 4c, Verso 8c, Estribillo 8c, Outro 4c.
Pistas: guitarra acústica, piano, bajo, pad suave, percusión ligera.
No apliques aún: solo plan.md y lista de tareas.
```

### Pensar / preview

```text
Piensa el arreglo completo (Music Build en preview, sin aplicar):
género reggaeton, 95 BPM, D menor, 90 segundos.
Pistas: drums, bass, piano, pad, lead.
Quiero progresión i–VI–III–VII y estribillo más denso.
```

### Crear — Music Build

```text
Music Build aplicar:
- Género: metal core, 140 BPM, E menor, 2 minutos
- Secciones: Intro 4, Riff 8, Breakdown 4, Chorus 8, Outro 4
- Pistas: Drums (BFD o Roles), Bass, Rhythm guitar, Lead, Pad
- Preferir presets de la Biblioteca si existen; si no, JasWave Roles
- Mezcla inicial con sends a reverb suave
```

```text
Music Build nativo (solo JasWave Piano/Roles), soft pad:
balada 80 BPM, C mayor, 1 minuto, piano + pad + bajo.
Sin VSTs externos.
```

### Instrumentos / DecentSampler

```text
En la pista "Piano", inserta DecentSampler (Descent).
Si no está en catálogo, usa la ruta Common Files VST3.
No digas que está listo hasta que el host confirme el slot.
```

```text
Lista presets globales de la Biblioteca que sirvan para pad cinematográfico y aplícalo a la pista Pad.
```

### Mezcla

```text
Balancea volúmenes: kick y bajo claros, voces/lead un poco delante, pads atrás.
Panea guitarras L/R. Crea bus Reverb FX y sends 15–30% según rol.
No uses sidechain (no es audible en 1.0).
```

```text
Escribe automatización de volumen en el pad: sube 3 dB en el estribillo y baja en el verso.
```

### Master y entrega

```text
Haz un masterPass target streaming, luego bounce WAV de todo el proyecto con normalize LUFS -14 y listen target streaming.
Si listen falla, dime qué ajustar antes de dar por bueno el master.
```

```text
Exporta stems por pista además del bounce estéreo.
```

### Edición MIDI puntual

```text
En el clip del bajo del verso: cuantiza a semicorcheas, humaniza un poco la velocidad, y baja las notas que estén fuera de E menor.
```

```text
Transpone el lead +5 semitonos solo en el estribillo (clip correspondiente).
```

### Freeze / rendimiento

```text
Haz freeze de la pista Kontakt cuando el bounce de esa pista suene bien.
```

---

## Qué pedir (y qué no)

| Pide | Evita |
|------|--------|
| Género, BPM, tonalidad, minutos, roles | “Haz algo bonito” sin datos |
| Nombres de preset / DecentSampler + preset | Asumir que el VST suena sin preset |
| “Confirma host slot” | Creer que insertar = audio garantizado |
| Music Build para multi-pista | Un solo `generateMidiSong` para toda la canción |
| Sends / EQ VST | Sidechain “de DAW” en 1.0 |

## Diff, certify y revertir

- Las propuestas pueden mostrar **diff** y aceptar/rechazar por acción.
- Tras un turno, badges de **certify** / verificación.
- **Revertir esta respuesta** deshace el bloque de undo de ese turno.

Siguiente: [09 · Mezcla y exportar](./09-mezcla-y-exportar.md).
