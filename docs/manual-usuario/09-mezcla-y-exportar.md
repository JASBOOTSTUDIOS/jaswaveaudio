# 09 · Mezcla y exportar

## Antes de exportar — checklist

1. Reproduce de principio a fin sin clips mudos inesperados.
2. Quita solos accidentales; revisa mutes.
3. Master no al rojo constante (true peak / clipping).
4. VSTs con caption **host listo** en pistas MIDI importantes.
5. `Ctrl+S`.

## Diálogo Exportar / bounce

**Archivo → Exportar bounce WAV…**

| Opción | Notas |
|--------|--------|
| **WAV** | Siempre disponible |
| **FLAC / MP3** | Requiere `ffmpeg` en PATH; si falta, la UI lo deshabilita |
| Duración | Desde 0 hasta los segundos que indiques |
| Bit depth 16/24 | WAV |
| Normalizar | Off / Peak −1 dBTP / LUFS −14 |
| Listen target | Streaming / Club / CD / Off — informe post-bounce |
| Stems | Carpeta con stems dry por pista |
| Progreso / Cancelar | Sí |

La cadena de bounce es la **misma nativa** que Play (clips + VST + FX + sends).  
Si hay MIDI con VST **sin slot host**, el bounce **aborta** con error (mejor que un WAV silencioso).

## Medidores / Listen

Tras bounce, panel **Medidores**:

- LUFS integrados, true peak
- Listen OK / FAIL según target
- Espectro / estéreo

No digas “master listo” si Listen falla: baja master, ajusta picos, re-exporta.

## Stems

Los stems exportados son **dry** (sin la misma cadena FX/sends del master bounce). Úsalos para remix externo o archivo; el bounce estéreo es la referencia de entrega.

## Master Pass (asistido)

Pide al Asistente:

```text
daw.masterPass target streaming; luego bounce con listen.
```

Revisa el informe; el humano siempre valida de oído.

## Destinos típicos

| Destino | Orientación |
|---------|-------------|
| Streaming | ~−14 LUFS, true peak ≤ −1 dBTP |
| Club | Más hot (según target del análisis) |
| CD | Dinámica distinta — usa el preset listen de la app |

Siguiente: [10 · Atajos](./10-atajos.md).
