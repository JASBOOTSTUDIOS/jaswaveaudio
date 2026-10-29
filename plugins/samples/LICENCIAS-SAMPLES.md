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
| Worship Drums, kit `muldjord` | MuldjordKit (mismo banco, registrado también como kit en `drum-kits/muldjord/`) | Lars Muldjord | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Los de arriba |
| Worship Drums, kit `naked` (rock/pop) | «Naked Drums» (https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums) | Wilkinson Audio (SFZ en formato ARIA: kinwie) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Mezcla de micrófonos directos, overheads y sala cercana (alineados en fase), 3 a 5 capas de velocidad y 3 a 5 round-robin por pieza, remuestreo, normalización por pieza, recorte de silencio y fundidos, PCM 16 bits con dither, formato `.jws`; la campana de crash (nota 78) también está en el kit `percusion`; el golpe «Joey Jordison» (nota 40) es una segunda caja, no un rimshot; nota 35 = bombo 150 cents más grave |
| Worship Drums, kit `drskit` (jazz-rock) | «DRSKit» (port SFZ v1.0, https://github.com/sfzinstruments/DrumGizmo.DRSKit) | Equipo DrumGizmo (Lars Muldjord, Bent Bisballe Nyeng) y Jes Eiler (DRSDrums); port SFZ de kinwie | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Mezcla estéreo de micrófonos cercanos, overheads y ambiente, reducción de capas y round-robin, remuestreo, normalización por pieza, recorte y fundidos, PCM 16 bits con dither, formato `.jws`; sin whiskers ni cadenas de ride |
| Worship Drums, kit `percusion`, nota 78 | Campana de crash de «Naked Drums» | Wilkinson Audio (SFZ: kinwie) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | Los de `naked`; por esa nota el `kit.json` del kit `percusion` declara CC BY 4.0 (el resto es CC0) |

## Dominio público (CC0 1.0), sin obligación; se agradece

| Instrumento | Fuente | Autor / origen |
|---|---|---|
| Electric Bass | FingerBassYR y PickedBassYR (FreePats) | Andrea Biasior (Yamaha RBX); adaptación roberto@zenvoid.org |
| Electric Guitar | EGuitarFSBS-clean (FreePats) | FreePats (Fender eléctrica con amplificador y rack de efectos) |
| Strings Section | VSCO 2 Community Edition | Versilian Studios (Sam Gossner y colaboradores) |
| Shimmer Pad, Ambient Atmos | SynthPadChoir (Elf of Happy and Love), NewAge y SweepPad (roberto@zenvoid.org), SynthPadBowed (Strix SoundFont Team), todos de FreePats; VSCO 2 CE | Ver cada README |
| Ambient Atmos (guitarras) | EGuitarFSBS-clean (FreePats), la misma fuente que Electric Guitar | FreePats |

Baterías y percusión (kits de Worship Drums; bancos en `%APPDATA%\JasWave\samples\drum-kits\<slug>\`, convertidos con `plugins/samples/tools/kit_sfz2jws.py` y `percusion2jws.py`; cambios: mezcla de micrófonos, remuestreo a 44,1 kHz, normalización por pieza, recorte de silencio y colas con fundido, reducción de capas y round-robin, PCM 16 bits con dither, formato `.jws`):

| Kit (slug) | Fuente | Autor / origen | Notas con muestras reales |
|---|---|---|---|
| `virtuosity` (jazz) | «Virtuosity Drums» v0.925 (https://versilian-studios.com/virtuosity-drums/); micros mid + cercanos de bombo y caja | Versilian Studios (batería: Austin McMahon, Virtuosity Musical Instruments, Boston) | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 53 55 57 59 100 |
| `swirly` (indie, escobillas) | «Swirly Drums» v1.1 (https://github.com/sfzinstruments/karoryfer.swirly-drums), solo micros secos | Karoryfer Samples | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 52 55 57 100 |
| `bigrusty` (rock/metal vintage) | «Big Rusty Drums» (https://github.com/sfzinstruments/karoryfer.big-rusty-drums) | Karoryfer Samples | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 52 53 57 59 100 |
| `percusion` | Virtuosity Drums (perc/mid), VCSL (Versilian Community Sample Library, https://github.com/sgossner/VCSL), FreePats World Percussion (2020-09-05), body_percussion (https://github.com/sfzinstruments/body_percussion) | Versilian Studios; Xavimart, Gonzalo y Roberto (FreePats); sfzinstruments | 39 54 56 58 60 61 62 63 64 67 68 69 70 71 72 73 74 75 76 77 80 81 82 83 84 85 (+ 78 de Naked Drums, CC BY) |

## Texto de crédito para el instalador y «Acerca de»

> Muestras de piano: «Salamander Grand Piano V3» de Alexander Holm, licencia CC BY 3.0, modificadas.
> Muestras de batería: «MuldjordKit» de Lars Muldjord (CC BY 4.0), «Naked Drums» de Wilkinson Audio (CC BY 4.0) y «DRSKit» del equipo DrumGizmo
> y Jes Eiler (CC BY 4.0), modificadas; «Virtuosity Drums» de Versilian Studios, «Swirly Drums» y «Big Rusty Drums» de Karoryfer Samples (CC0).
> Percusión: Virtuosity Drums y Versilian Community Sample Library (CC0), FreePats World Percussion y body_percussion (CC0).
> Bajo, guitarra, cuerdas y pads: FreePats y VSCO 2 Community Edition (CC0).

Las modificaciones están descritas arriba. Las licencias completas están en los enlaces indicados.

## Bancos generados de Ambient Atmos

`ambient-atmos-guitar.jws`, `-pads.jws` y `-textures.jws` no son muestras directas: los genera `plugins/samples/tools/atmos_gen.py` (reproducible, con semilla) a partir de las fuentes CC0 de arriba mediante estiramiento espectral tipo PaulStretch (FFT con fases aleatorias), mezcla, filtrado, saturación y síntesis aditiva/ruido filtrado, con bucles sin costura. Solo se toma la idea de estilo de las librerías de texturas cinemáticas: no incluyen muestras, nombres ni textos de ninguna librería comercial. Obra derivada de material CC0; sin restricciones de uso.
