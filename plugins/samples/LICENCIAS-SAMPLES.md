# Licencias y créditos de las muestras de instrumentos

Los instrumentos de JasWave (`JasWave Grand Piano`, `Worship Drums`, `Electric Bass`, `Electric Guitar`, `Strings Section`,
`Shimmer Pad`, `Ambient Atmos`) pueden usar bancos de muestras reales. **Los bancos no están en el repositorio**: se generan
con `plugins/samples/tools/sfz2jws.py` a partir de las fuentes de abajo y viven en `%APPDATA%\JasWave\samples`
(`JASWAVE_SAMPLES_DIR` para cambiar la carpeta). Sin banco, cada instrumento sigue sonando con su motor modelado.

Política: solo licencias que permiten redistribuir y usar comercialmente: **CC0** (sin condiciones) y **CC BY** (con
atribución). Los créditos CC BY son obligatorios y se muestran en el instalador, en «Acerca de» y aquí.

## Atribución obligatoria (CC BY)

| Instrumento | Fuente | Autor | Licencia | Cambios realizados |
|---|---|---|---|---|
| Grand Piano | Salamander Grand Piano V3 (versión SFZ+FLAC de FreePats) | Alexander Holm (adaptación FreePats: roberto@zenvoid.org) | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | Reducción a 5 capas de velocidad, remuestreo a 44,1 kHz, recorte de silencio y colas con fundido, normalización de nivel por capa, eliminación de las muestras de ruido de tecla, conversión a PCM 16 bits con dither, formato `.jws` |
| Worship Drums | MuldjordKit (versión SFZ+FLAC de FreePats) | Lars Muldjord | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Remuestreo, normalización por pieza, recorte y fundidos, conversión a PCM 16 bits con dither, formato `.jws` |

## Dominio público (CC0 1.0), sin obligación; se agradece

| Instrumento | Fuente | Autor / origen |
|---|---|---|
| Electric Bass | FingerBassYR y PickedBassYR (FreePats) | Andrea Biasior (Yamaha RBX); adaptación roberto@zenvoid.org |
| Electric Guitar | EGuitarFSBS-clean (FreePats) | FreePats (Fender eléctrica con amplificador y rack de efectos) |
| Strings Section | VSCO 2 Community Edition | Versilian Studios (Sam Gossner y colaboradores) |
| Shimmer Pad, Ambient Atmos | SynthPadChoir (Elf of Happy and Love), NewAge y SweepPad (roberto@zenvoid.org), SynthPadBowed (Strix SoundFont Team), todos de FreePats; VSCO 2 CE | Ver cada README |
| Ambient Atmos (guitarras) | EGuitarFSBS-clean (FreePats), la misma fuente que Electric Guitar | FreePats |

## Texto de crédito para el instalador y «Acerca de»

> Muestras de piano: «Salamander Grand Piano V3» de Alexander Holm, licencia CC BY 3.0, modificadas.
> Muestras de batería: «MuldjordKit» de Lars Muldjord, licencia CC BY 4.0, modificadas.
> Bajo, guitarra, cuerdas y pads: FreePats y VSCO 2 Community Edition (CC0).

Las modificaciones están descritas arriba. Las licencias completas están en los enlaces indicados.

## Bancos generados de Ambient Atmos

`ambient-atmos-guitar.jws`, `-pads.jws` y `-textures.jws` no son muestras directas: los genera `plugins/samples/tools/atmos_gen.py` (reproducible, con semilla) a partir de las fuentes CC0 de arriba mediante estiramiento espectral tipo PaulStretch (FFT con fases aleatorias), mezcla, filtrado, saturación y síntesis aditiva/ruido filtrado, con bucles sin costura. Solo se toma la idea de estilo de las librerías de texturas cinemáticas: no incluyen muestras, nombres ni textos de ninguna librería comercial. Obra derivada de material CC0; sin restricciones de uso.
