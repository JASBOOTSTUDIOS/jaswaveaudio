# L — Baterías y percusión reales muestreadas: investigación de fuentes y licencias

> Estado: **investigación y verificación** (29-10-2026). No se ha convertido ni instalado nada. Todo lo de abajo se comprobó en
> la página oficial, en el repositorio oficial (API de GitHub, `LICENSE` y árbol de ficheros) o con una petición HEAD / de los
> primeros bytes. Lo que no se pudo verificar está marcado como **SIN VERIFICAR**.

## 0. Contexto y política

- Política vigente (`plugins/samples/LICENCIAS-SAMPLES.md`): solo **CC0 / dominio público** y **CC BY** (con crédito en
  instalador y «Acerca de»). Los bancos no van en git; se generan como `.jws` en `%APPDATA%\JasWave\samples`.
- Hoy: banco único MuldjordKit (CC BY 4.0, 422 zonas, 213 MB) con mapa GM descrito en la cabecera de
  `worship_drums_dsp.h` (35/36, 37, 38, 40, toms 41-50, hi-hat 42/44/46, platos 49/51/52/53/55/57/59). **Faltan** palmas (39),
  pandereta (54), cencerro (56), vibraslap (58), bongós/congas/timbales (60-66), agogó (67/68), cabasa/maracas/shaker
  (69/70/82), claves (75), woodblock (76/77), triángulo (80/81), etc.
- Herramientas existentes: `sfz2jws.py` (SFZ genérico: WAV/FLAC, capas de velocidad, bucles) y `muldjord_kit2jws.py`
  (remapeo a GM, round-robin por `lorand/hirand`, herencia de `<group>`, mezcla de micros, choke de hi-hat, presupuesto de
  tamaño). Convertidor `.jws` v1: zonas de 64 B, PCM16.
- Escala de dificultad de conversión usada abajo:
  - **Baja**: SFZ plano, un micro, sin macros; sirve `sfz2jws.py` o un cartografiado corto.
  - **Media**: SFZ con `#include`/`#define`, varios micros que hay que elegir/mezclar, round-robin por `seq_position`; hace
    falta un conversor tipo `muldjord_kit2jws.py` (nuevo script por kit, mismas funciones de limpieza).
  - **Alta**: formato no SFZ (DrumGizmo XML multicanal, Kontakt) o presupuesto de tamaño difícil.

## (a) Kits de batería recomendados, por prioridad

Todas las URL comprobadas: respuesta HTTP 200 y cabeceras (tamaños = `Content-Length` o suma de ficheros del árbol de Git).
Los repositorios `sfzinstruments/*` incluyen las muestras en el propio repo (Git LFS no; descarga con el zip de la rama).

| Prio | Kit (nombre exacto) | Autor | Licencia | Estilo | Piezas | Capas / RR | Formato | Tamaño | Descarga directa | Estudio/directo | Dif. |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Virtuosity Drums** v0.925 | Versilian Studios (batería: Austin McMahon, Virtuosity Musical Instruments, Boston) | **CC0** (`LICENSE` = CC0 1.0 Universal) https://creativecommons.org/publicdomain/zero/1.0/ | **Jazz de club** (también vale para pop/folk); toca con baquetas | Bombo (con/sin bordones), caja (centro, descentrada, stickshot, **rimshot**, **cross-stick**, mute, mute a medias, flam, buzz, redoble CC1), 2 toms (7 articulaciones), hi-hat (cerrado, abierto, pedal, ½, ¾, splash), **ride y campana de ride**, flat ride (también crash), crash y crash sizzle, **y percusión auxiliar GM completa** (ver (b)) | Hasta 36 capas en caja/toms/bombo; platos con pocas capas y 4 RR; caja/toms/bombo sin RR | SFZ + FLAC/WAV (banco Sforzando, SFZ de ARIA); 6 posiciones de micro (kick, snare, OH, mid, room, vintage) | 1,23 GB (zip oficial), 1,47 GB descomprimido; un solo micro «mid» ≈ 0,5 GB | https://versilian-studios.com/Distro/Virtuosity_Drums_v0.925.zip (1.227.151.376 B, comprobado). Repo: https://github.com/sfzinstruments/virtuosity_drums | Estudio/sala de directo, multimicro (6) | Media-alta |
| 2 | **Naked Drums** | Wilkinson Audio (SFZ por kinwie) | **CC BY 4.0** (`LICENSE`; página sfzinstruments: CC-BY-4.0) https://creativecommons.org/licenses/by/4.0/ | **Rock/pop moderno** limpio (Yamaha Recording Custom 22", toms 10-16", cajas Ayotte 14x5 y Pearl Joey Jordison 13x6,5) | Bombo, 2 cajas, 5 toms, **side-stick**, hi-hat (cerrado/semi/abierto/pedal), ride arco y **campana**, 2 crashes con arco y **campana de crash**, splash, china, **chokes**; mapa GM propio incluido | Hasta 5 capas; **10 round-robin** | SFZ v2 (ARIA) + FLAC 44,1 kHz; micros directos + OH + room cercano + salas lejanas + M/S | 1,3 GB | https://github.com/sfzinstruments/WilkinsonAudio.NakedDrums/archive/refs/heads/master.zip (200 OK) | Estudio, multimicro | Media-alta |
| 3 | **Swirly Drums** v1.1 | Karoryfer Samples | **CC0** (`license`) | **Indie/punk lo-fi con escobillas**; incluye percusión | Bombo (cajón-kick, marching, buzz), caja (main, edge, flutter, **dig** y **stir** de escobilla), 5 toms, hi-hat en 7+ aperturas (cerrado, tight, cuarto, medio, abierto, sizzling, pedal, foot-splash), ride, crash, crash «roto», splash, splash agrietado, china, **cencerro, bongó alto/bajo, djembé, darbuka** | 5-6 RR; capas por pieza (ver manual `Swirly_Drums_User_Guide_1.1.pdf`) | SFZ + WAV, micros «dry/wet/wetter» | 1,8 GB (la mayor parte son los ambientes `wet`/`wetter`; solo seco ≈ 0,25 GB) | https://github.com/sfzinstruments/karoryfer.swirly-drums/archive/refs/heads/main.zip (200 OK) | Estudio, escobillas | Media |
| 4 | **Big Rusty Drums** | Karoryfer Samples | **CC0** (`LICENSE`) | **Rock/metal/vintage años 80** (kit polaco sobredimensionado: bombo 24", toms 14/15/18/22") | Bombo (con y sin apagador), caja con golpes/aro/escobilla/stir, 4 toms, hi-hat 14" (cerrado, pedal, variable), **ride 22" con campana**, ride sizzle, crashes 17", **china 18"**, stack, ruidos mecánicos | Muchas capas y RR (4.366 FLAC + 100 WAV) | SFZ + FLAC/WAV, varios micros | 0,7 GB (600 MB FLAC + 106 MB WAV) | https://github.com/sfzinstruments/karoryfer.big-rusty-drums/archive/refs/heads/main.zip (200 OK) | Estudio | Media |
| 5 | **MuldjordKit** (ya integrado; la fuente completa es DrumGizmo) | Lars Muldjord | CC BY 4.0 | Rock (ya cubierto) | — | — | DrumGizmo 16 canales o estéreo FreePats | repo 329 MB | Ya en uso | — | — |
| 6 | **Unruly Drums** | Karoryfer Samples | **CC0** | **Experimental/indie**: todos los tambores (incluido el bombo) llevan bordones; baquetas y escobillas | Cajas 13/14/22", bombo 20", hi-hat 14", crash 16", ride 20", clicks | Miles de muestras (5.624 FLAC + 241 WAV) | SFZ + FLAC/WAV | 0,8 GB | https://github.com/sfzinstruments/karoryfer.unruly-drums/archive/refs/heads/main.zip (200 OK) | Estudio | Media |
| 7 | **DRSKit** v2.1 | DrumGizmo + Jes Eiler (DRSDrums) | **CC BY 4.0** | **Jazz a rock** (Paiste Formula 602) | 1 bombo, 3 toms, 1 caja, hi-hat, 2 crashes, ride (sin campana según la página) | No indicadas en la página | DrumGizmo XML, 13 canales; hay **port SFZ v1.0** en `sfzinstruments` (repo `DrumGizmo.DRSKit`, 718 MB) | 2,8 GB (zip v2.1) / 718 MB (port SFZ) | https://drumgizmo.org/kits/DRSKit/DRSKit2_1.zip (2.803.397.710 B) | Estudio, multimicro | Alta (XML) o Media (port SFZ) |
| 8 | **CrocellKit** v1.1 | DrumGizmo / banda Crocell (estudio JBOSound) | **CC BY 4.0** | **Metal** (doble bombo) | Bombo, 2 toms colgados + 2 de suelo, caja, hi-hat, **3 crashes, ride, 2 chinas, 2 splash** | No indicadas en la página | DrumGizmo XML, 15 canales; mezcla estéreo `CrocellKit_Stereo_MIX.rar` (561 MB) | 5,6 GB completo / 0,56 GB mezcla estéreo | https://drumgizmo.org/kits/CrocellKit/CrocellKit1_1.zip (5.646.502.341 B); estéreo: https://drumgizmo.org/kits/CrocellKit/CrocellKit_Stereo_MIX.rar | Estudio | Alta |
| 9 | **The Aasimonster** v2.1 | DrumGizmo (convertido por Chaot4) | **CC BY 4.0** | **Death metal** (2 bombos, chinas de 8/10/18", zilbel) | 2 bombos, 3 toms colgados + 1 de suelo, 2 crashes 16", china 18", 2 chinas pequeñas, zilbel, ride; hi-hat solo como micro (no listado) | No indicadas | DrumGizmo XML, 16 canales | 2,4 GB | https://drumgizmo.org/kits/Aasimonster/aasimonster2_1.zip (2.416.291.882 B) | Estudio | Alta |
| 10 | **Frankensnare** | Karoryfer Samples | **CC0** | **Colección de cajas** (≈ 30 cajas distintas: 10x6 ash, 14x5 maple con escobilla, 14x8 aluminio, 22x14 birch preparado, ziggurat…) | Solo cajas | Muy variable | SFZ + FLAC/WAV | 0,36 GB | https://github.com/sfzinstruments/karoryfer.frankensnare/archive/refs/heads/main.zip (200 OK) | Estudio | Baja-media (elegir 3-4 cajas) |
| 11 | **Gogodze Phu Vol II** | Karoryfer Samples (2018) | **CC0** («royalty-free» en readme; `LICENSE` CC0) | **Lo-fi psicodélico años 70** (Kim Jung Mi «Now») | Bombo, caja, 3 toms, hi-hat; 7 micros distintos (de lo-fi a hi-fi) | Ver SFZ | SFZ + WAV | 0,48 GB | https://github.com/sfzinstruments/karoryfer.gogodze-phu-vol-ii/archive/refs/heads/master.zip (rama `master`) | Estudio | Media |
| 12 | **The Hat With The Phat** | Karoryfer Samples | **CC0** | Hi-hat **sobredimensionado** (dos rides) con aperturas continuas por CC4 | Solo hi-hat: cerrado, abierto, loose, sizzle, chik, pedal, campana de hi-hat | RR varios | SFZ + WAV | 0,98 GB | https://github.com/sfzinstruments/Karoryfer.TheHatWithThePhat/archive/refs/heads/master.zip (200 OK) | Estudio | Media (solo si se quiere una cadena de hi-hat en varias aperturas) |
| 13 | **Salamander Drumkit** | Alexander Holm (SFZ: kinwie) | **CC BY-SA 3.0** según el catálogo sfzinstruments → **«SA, requiere decisión»** (el README de GitHub remite a la licencia del archivo original; **no se pudo confirmar el texto exacto**) | Rock/pop clásico (muy conocido) | Bombo, caja, toms, hi-hat, ride, crashes FX | Varias | SFZ | repo pequeño (40 MB sin muestras; las muestras vienen de linuxaudio.org / Internet Archive) | https://github.com/endolith/Salamander-Drumkit/archive/refs/heads/master.zip (200 OK, **solo mapeo**; las muestras hay que bajarlas aparte) | Estudio | Media |

Notas por kit:
- **Virtuosity Drums** es la mejor relación calidad/licencia: CC0, estilo jazz que ahora no cubrimos, con **percusión auxiliar GM
  completa** que reutilizamos en el mapa de percusión. Para JasWave basta un micro (`mid`/`close`) más overheads para presupuesto
  razonable (≈ 0,45 GB `mid` en total entre kit y percusión).
- **Naked Drums** aporta la **campana de crash** y la **campana de ride** de rock real, y 10 RR (suena menos «máquina»).
- **Swirly Drums** da las **escobillas** (brushes) en caja y toms (`snare_dig`, `snare_stir`), que ninguna otra fuente cubre, y
  cencerro/bongós reales. Excluyendo los ambientes `wet`/`wetter`, pesa ≈ 0,25 GB.
- Los kits DrumGizmo (DRS, Crocell, Aasimonster) son **XML multicanal enormes**. Para JasWave solo merecen la pena Crocell
  (metal) y quizá DRSKit (jazz-rock): la **mezcla estéreo de Crocell** (561 MB) evita el XML multicanal si se acepta una mezcla
  preestablecida. **SIN VERIFICAR**: número exacto de capas de velocidad (la página oficial no lo dice; hay que contarlas en el XML).
- Estilo **funk, pop/worship, indie**: no hay un kit dedicado con licencia válida; se cubre con (1) Naked Drums (pop/rock limpio),
  (2) Virtuosity (club/funk-jazz con rimshot y ghost notes), (3) Swirly (indie), (4) el propio MuldjordKit (worship/rock) y
  variaciones de afinación/amortiguación en la conversión (rutas `muldjord_kit2jws.py`).

## (b) Percusión y campanas

| Componente | Nota GM | Fuente recomendada (licencia) | Contenido verificado | Encaja en el mapa |
|---|---|---|---|---|
| **Campana de ride** | 53 (ya está en el DSP actual) | Virtuosity (CC0, `RIDE_BELL_KEY 53`), Naked Drums (CC BY 4.0, `KEY_RD_BEL 53`), Big Rusty (CC0, `rdblkey 53`), SM Drums (**SIN VERIFICAR**) | Real, varias capas | Sí, nota 53 |
| **Campana de crash** | 58 ó 59 (hueco práctico; GM no la define) | Naked Drums (CC BY 4.0: `CRS1_BEL 58`, `CRS2_BEL 59`), Big Rusty `crcrkey`/`crchkey` (choke) | Real | Sí, hay que añadir notas (58 choca con vibraslap; usar nota interna ≥ 100 como el hi-hat semiabierto) |
| Crashes variados / splash / chinas | 49, 55, 57, 52 | Big Rusty (crash 17", sizzle, china 18"; CC0), Swirly (crash, crash roto, splash, splash agrietado, china; CC0), Naked (2 crashes, 2 splash, 2 chinas; CC BY), Crocell (3 crashes, 2 chinas, 2 splash; CC BY) | Real | Sí |
| Hi-hat en varias aperturas | 42, 44, 46 (+54/56/58 interno) | Swirly (siete aperturas), Virtuosity (cerrado, ½, ¾, abierto, pedal, splash), The Hat With The Phat (CC4 continuo), VCSL Hi-Hat Cymbal (CC0: cerrado, abierto, loose, ¾) | Real | Sí |
| **Cross-stick / side-stick** | 37 | Virtuosity (CC0, `snare – cross-stick`, `stickshot`), Naked (CC BY, `KEY_SIDE 37`), Big Rusty (CC0, `snrimskey` aro) | Real | Sí, 37 |
| **Rimshot** | 40 | Virtuosity, Big Rusty, Naked (`KEY_SNR2`) | Real | Sí |
| **Palmas (claps)** | 39 | VCSL **Claps** (CC0: 6 RR de grupo + 4 solistas), FreePats **World percussion** (CC0, «Hand clap»), `body_percussion` (CC0, handclap/fingerclap/snaps) | Real (palmas humanas) | Sí, 39 |
| **Pandereta** | 54 | VCSL Tambourine 1 y 2 (CC0; golpe, redoble y shake), FreePats World (CC0), Virtuosity/VSCO 2 (CC0) | Real | Sí, 54 |
| **Cencerro (cowbell)** | 56 | VCSL **Cowbells** (CC0: 13 muestras, normal/mute/doble, 3-4 capas), Swirly (CC0, tecla 66), Virtuosity (CC0) | Real | Sí, 56 |
| **Vibraslap** | 58 | VCSL **Vibraslap** (CC0, 4 RR), Virtuosity (CC0) | Real | Sí, 58 |
| **Shaker / maracas / cabasa** | 69, 70, 82 | VCSL Shaker large/small, Cabasa (CC0), FreePats World (egg shaker, maracas; CC0), Virtuosity (CC0) | Real | Sí, 69/70/82 |
| **Triángulo** | 80 (mute) / 81 (abierto) | VCSL **Triangles** (CC0, 63 muestras, 75 MB), Virtuosity (CC0) | Real | Sí, 80/81 |
| **Claves** | 75 | VCSL Claves (CC0, 2 pares × 3 capas), FreePats World (CC0), Virtuosity | Real | Sí, 75 |
| **Woodblock** | 76 / 77 | VCSL Woodblock (CC0, 10 muestras), Virtuosity (CC0) | Real | Sí, 76/77 |
| **Bongós** | 60 / 61 | VCSL Bongos (CC0, 28 muestras), Swirly (alto/bajo; CC0), FreePats World (CC0), Virtuosity (CC0) | Real | Sí, 60/61 |
| **Congas** | 62 / 63 / 64 | VCSL Conga (CC0, 34 muestras), FreePats World (CC0), Virtuosity (CC0) | Real | Sí, 62-64 |
| **Timbales** | 65 / 66 | Virtuosity (CC0, `TIMBH`/`TIMBL`: **aviso del autor «no mics for that»**, solo un micro). VCSL **no** trae timbales. | Real pero limitado | Sí, 65/66 |
| **Agogó** | 67 / 68 | VCSL **Agogo Bells** (CC0: 2 campanas, 3 capas) y Virtuosity | Real | Sí, 67/68 |
| Güiro, cuíca, silbato, bell tree, cascabeles | 71-74, 78-79, 83-84 | Virtuosity (CC0; cuíca sin micros); VCSL Guiro, Bell Tree, Sleigh Bells (CC0) | Real | Opcional |
| Cajón, darbuka, djembé | (fuera del GM clásico) | VCSL Cajon; FreePats World (cajón flamenco, darbuka); Swirly (CC0) | Real | Opcional, notas libres |
| Timbal orquestal, bombo sinfónico, gong | (fuera) | VCSL Timpani 1/2 (hasta 292 MB), Bass Drum 1/2, Gong 1/2, Suspended Cymbal 1/2 (CC0); FreePats **Timpani** (SFZ-FLAC 9,4 MB, 2024-08-10) | Real | Opcional |
| Palmas/chasquidos/pisadas | — | `body_percussion` (CC0, 62 MB WAV) | Real | Opcional |

Fuentes de percusión (todas CC0 y verificadas):
- **VCSL — Versilian Community Sample Library** (`sgossner/VCSL`, licencia CC0 1.0 detectada por la API de GitHub; página:
  «Essentially it's Public Domain»). Versión `v1.2.2-RC` (zip de etiqueta 200 OK). WAV sueltos por instrumento («20-75 MB»
  cada uno); se pueden descargar **solo las carpetas necesarias** con `raw.githubusercontent.com` (comprobado: el WAV de
  `Cowbell1_Hit_v2_rr1_Mid.wav` devuelve `RIFF` y 199.568 B). Árbol: `Idiophones/Struck Idiophones/{Agogo Bells, Claps,
  Claves, Cowbells, Hi-Hat Cymbal, Shaker*, Tambourine 1/2, Triangles, Vibraslap, Woodblock, Cabasa, Guiro, Cajon,
  Suspended Cymbal 1/2, Gong 1/2…}` y `Membranophones/Struck Membranophones/{Bongos, Conga, Timpani 1/2, Bass Drum 1/2,
  Snare Drum Modern 1/2/3, Tom 1/2…}`. Instrumentos «Legacy» marcados aparte.
  Percusión útil (sin timbal ni bombos sinfónicos) ≈ 0,3 GB.
- **FreePats World percussion** (2020-09-05, CC0): cajón flamenco, bongós, egg shaker, pandereta, palmas, claves, castañuelas,
  conga, maracas, darbuka. SFZ+FLAC **6,6 MiB** (descarga HTTP 200, 6.972.087 B):
  https://github.com/freepats/world-percussion/releases/download/2020-09-05/WorldPercussion-SFZ+FLAC-20200905.7z .
  Es el paquete más barato y de **dificultad baja** (SFZ plano); claves y conga proceden de VCSL.
- **FreePats Timpani** (2024-08-10, CC0): https://github.com/freepats/timpani/releases/download/2024-08-10/Timpani-SFZ+FLAC-20240810.7z
  (9.373.264 B, 200 OK).

## (c) Descartado y por qué

| Candidato | Motivo |
|---|---|
| **Salamander Drumkit** como kit principal | Licencia **CC BY-SA 3.0** (catálogo sfzinstruments): *share-alike*, **requiere decisión**. Las muestras no están en GitHub (solo el mapeo). Se deja como opcional. |
| **Sam's Sonor** (Sam Greene) | **CC BY-SA 4.0** (SA) y sin URL de descarga en el catálogo (solo enlace de archivo web); muestras AIFF. |
| **SM Drums / «Deeply Sampled Free Drums»** (Scott McLean et al.) | El catálogo dice «Public Domain» sin enlace, pero **su propia página oficial no indica licencia** y el repo `sfzinstruments/SMDrums` no trae `LICENSE`. Además la descarga oficial es Google Drive (2,2 GB WAV). **SIN VERIFICAR**; no usar hasta tener un texto de licencia. Contiene ride 17"/20" con campana, sidestick, rimshot, 4 crashes, china (por nombres de mapeo SFZ), así que merece un correo al autor. |
| **Sonatina Symphonic Orchestra** (percusión) | Licencia **Creative Commons Sampling Plus 1.0**, no es CC0 ni CC BY (permite «sampling», no uso libre). Descartado. |
| **Hydrogen — kits oficiales** | Licencias por kit; la lista de Debian (únicos kits «libres»): GPL-2 / GPL-2+ (ElectricEmpireKit, HardElectro1, VariBreaks, Millo, ColomboAcousticDrumkit…), **CC BY-SA** (circAfrique, BJA_Pacific), **CC BY 3.0** (rumpf_kit_z01_h2; el README interno contradice y dice GPL → **dudoso**), **CC0** (Audiophob, kit de dubstep **SIN VERIFICAR** su contenido real). No hay kit GM/rock con CC0/CC BY claro. La lista oficial (`hydrogen-music.org/feeds/drumkit_list.php`) **no se pudo abrir**. Descartado salvo Audiophob a revisar. |
| **TR-808 / TR-909 / LinnDrum reales** | **No se encontró ningún pack con CC0/CC BY verificable.** Los repos `oramics/sampled` (LM-2, CR-78, TR-505, MRK-2) afirman «Public Domain» pero la procedencia es dudosa (LM-2 de un archivo de hyperreal.org; CR-78 de boxedear.com; TR-505 de un pack comercial «progsounds»; TR-909 Detroit sin licencia declarada) y **no son dominio público demostrable**; `ritchse/tidal-drum-machines` no tiene `LICENSE`. Packs de MusicRadar, Samples From Mars, F9 Audio, Wave Alchemy, Roland: «royalty free» **sin redistribución**. Descartado: requiere decisión legal. |
| **FreePats «Synthesizer percussion»** | CC0 y descargable (1,8 MiB, 200 OK), pero **no son muestras reales**: están sintetizadas con Yoshimi y Geonkick. No cumple el requisito de «real muestreado». Se podría ofrecer como kit «Electrónica sintética» marcado como tal. |
| **TicTokMen Retro Drums 1 / Moogdrums 1** (Casio RZ1, Drumtraks, Roland CR-8000…) | Sin licencia en el repositorio (`license: None`); el README dice «free use licenses» sin concretar. Descartado. |
| **TKDrums G1/L1** | «Freemium»: versión gratuita limitada, sin licencia específica. |
| Packs de Freesound / Archive.org | La búsqueda no devolvió un pack CC0 de cajas de ritmos verificado; cada sonido tiene licencia distinta y **la descarga exige cuenta/API key**. **SIN VERIFICAR**; solo se aceptaría con una lista concreta y licencia por muestra. |
| Voxengo Drum Service (platos) | Página oficial no accesible (404) y la licencia no se pudo leer: **SIN VERIFICAR**. |
| DrumGizmo **Sommerhack 2016 Kit** | CC BY 4.0, 12 MB (HTTP 200), pero contenido no musical (taza, silla, tronco, obturador). Descartado como batería; los chasquidos/palmas se cubren mejor con `body_percussion`. |
| DrumGizmo **ShittyKit** | Formato antiguo de capas fijas; **SIN VERIFICAR**. |
| `Karoryfer HorsePulse` | Es un tagelharpa, no percusión. |

## (d) Estimación de espacio en disco si se instalaran todos

Tamaños brutos (fuente) y estimación del banco `.jws` convertido (PCM16, 44,1 kHz, recorte de silencios y colas; referencia:
MuldjordKit 160 MiB FLAC → 213 MB `.jws`, 422 zonas). Con el presupuesto de ≈ 100-250 MB por kit:

| Grupo | Fuente bruta | `.jws` estimado |
|---|---|---|
| Virtuosity Drums (1 micro `mid` + percusión) | 1,23 GB (1,47 GB con 6 micros) | 250-350 MB (kit) + 60-100 MB (percusión) |
| Naked Drums (stereo OH+CR o MS) | 1,3 GB | 200-300 MB |
| Swirly Drums (sin `wet`/`wetter`) | 1,8 GB | 120-180 MB |
| Big Rusty Drums | 0,7 GB | 150-220 MB |
| Unruly Drums | 0,8 GB | 120-180 MB |
| Frankensnare (3-4 cajas) | 0,36 GB | 30-60 MB |
| Gogodze Phu II | 0,48 GB | 60-100 MB |
| Hat With The Phat (si se hace banco propio) | 0,98 GB | 100-150 MB |
| CrocellKit (mezcla estéreo) | 0,56 GB (5,6 GB completo) | 150-250 MB |
| DRSKit (port SFZ) | 0,72 GB (2,8 GB DrumGizmo) | 150-250 MB |
| The Aasimonster | 2,4 GB | 150-250 MB |
| Percusión VCSL (selección) + FreePats World + body_percussion | ≈ 0,4 GB | 80-140 MB |
| Timpani FreePats | 0,01 GB | 5-10 MB |
| **Total «todos»** | **≈ 12-16 GB descargas** (≈ 19 GB si se bajan completos los DrumGizmo) | **≈ 1,6-2,5 GB** instalados |

Plan realista de un primer lote (1-5 de la tabla (a) + percusión): ≈ 1,2-1,6 GB instalados y ≈ 5-6 GB de descargas.
Las cifras `.jws` son **estimaciones** (no se ha convertido nada); deben medirse con la primera conversión.

## (e) Propuesta de distribución

1. **Ningún banco en git** (coherente con la política actual). El repo solo lleva: los conversores (`plugins/samples/tools/*.py`),
   un manifiesto `plugins/samples/kits.json` (nombre, estilo, licencia, URL, SHA-256, tamaño, versión de conversión) y
   este documento.
2. **Descarga bajo demanda** desde una pantalla «Kits de batería» del plugin: el usuario elige un kit, la app baja el archivo
   fuente (o, mejor, un `.jws` ya convertido alojado por JasWave con la misma licencia y el crédito) a
   `%APPDATA%\JasWave\samples` y valida el hash. Para CC0/CC BY está permitido redistribuir los `.jws` convertidos; indicar
   «modificado» según CC BY.
3. **Créditos**: ampliar `LICENCIAS-SAMPLES.md`, `THIRD_PARTY_NOTICES.md` y «Acerca de» con una fila por kit usado.
   - CC BY 4.0: Naked Drums (Wilkinson Audio), CrocellKit/DRSKit/Aasimonster (DrumGizmo), MuldjordKit (Lars Muldjord).
     Texto: «`<kit>` de `<autor>`, CC BY 4.0, modificado (recorte, normalización, conversión a PCM 16 bits)».
   - CC0: Virtuosity, Karoryfer, VCSL, FreePats World y Timpani, `body_percussion` (sin obligación; se agradece en «Acerca de»).
4. **Instalador**: no incluir kits por defecto; ofrecer «Worship/Rock (MuldjordKit)» como ahora y descargar el resto.
   Reutilizar el mecanismo de módulos del instalador (D1) si existe.
5. **Orden de implementación sugerido**: (1) percusión auxiliar (FreePats World + VCSL + Virtuosity aux; 39, 54, 56, 58, 60-70,
   75-77, 80-82) con un convertidor nuevo `percusion2jws.py`; (2) Virtuosity Drums (jazz); (3) Naked Drums (rock/pop con campanas);
   (4) Swirly Drums (escobillas/indie); (5) Big Rusty (metal/vintage); (6) CrocellKit estéreo (metal); (7) resto.
6. **Decisiones pendientes para el usuario**: ¿aceptar CC BY-SA (Salamander, Sam's Sonor)?; ¿ofrecer el kit electrónico sintético
   de FreePats marcándolo como «sintético»?; ¿contactar a los autores de SM Drums y de Hydrogen/Audiophob para aclarar licencia?;
   ¿pedir permiso al autor de `oramics/sampled` o buscar un pack 808/909 con licencia clara (p. ej. grabar el propio hardware)?

## (f) Notas de traspaso

**Estado (29-10-2026, agente L1): bancos convertidos, validados y escritos en `%APPDATA%\JasWave\samples\drum-kits\<slug>\`**
(`<slug>.jws` + `kit.json`, contrato de kits). Ningún banco va en git. Total instalado: 637 MB. Todos pasan
`plugins/samples/tools/jws_kit_validate.py` (carga con la misma lógica que `Bank::load` de `jw_sampler.h`, zonas por nota,
velocidades 1..127 sin huecos ni solapes, round-robin completos, ninguna muestra a fondo de escala, `kit.json` coherente).

| slug | Estilo | Licencia | Tamaño | Zonas | Notas con muestras reales (`kit.json.notas`) |
|---|---|---|---|---|---|
| `muldjord` | worship moderno | CC BY 4.0 | 213,5 MB | 422 | 35 36 38 40 41 42 43 44 45 46 47 48 49 50 51 52 53 55 57 59 100 (copia de `worship-drums.jws`; el original sigue en su sitio) |
| `virtuosity` | jazz de club | CC0 | 110,6 MB | 262 | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 53 55 57 59 100 |
| `naked` | rock/pop moderno | CC BY 4.0 | 103,9 MB | 271 | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 52 53 55 57 **78** 100 |
| `swirly` | indie/escobillas, lo-fi | CC0 | 53,9 MB | 369 | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 52 55 57 100 |
| `bigrusty` | rock/metal vintage | CC0 | 69,1 MB | 381 | 35 36 37 38 40 41 42 43 44 45 46 47 48 49 50 51 52 53 57 59 100 |
| `drskit` | jazz-rock | CC BY 4.0 | 77,6 MB | 283 | 35 36 38 40 41 42 43 44 45 46 47 48 49 50 51 53 57 59 100 |
| `percusion` | percusión auxiliar | CC BY 4.0 (CC0 salvo la nota 78) | 38,7 MB | 260 | 39 54 56 58 60 61 62 63 64 67 68 69 70 71 72 73 74 75 76 77 78 80 81 82 83 84 85 |

Conversores nuevos (README en `plugins/samples/tools/README-kits.md`): `jws_kit_lib.py` (biblioteca común), `kit_sfz2jws.py`
(catálogos `cat_virtuosity|naked|swirly|bigrusty|drskit` y `muldjord`), `percusion2jws.py`, `jws_kit_validate.py`.
Mismo tratamiento de audio y mismos niveles por clase de pieza que MuldjordKit (`sfz2jws.py`: 44,1 kHz, recorte, fundidos,
normalización por RMS del ataque con curva de dinámica, PCM 16 bits con dither); el RMS de la capa más fuerte de cada nota queda
a unos pocos dB del de MuldjordKit (ver la salida del validador). WAV de prueba por kit (golpes sueltos a vel. 40 y 100, y groove
de 2 compases; en `percusion` un patrón de percusión) en `plugins/com.jaswave.plugin.worship-drums/out/kits/<slug>-golpes.wav`
y `-groove.wav` (carpeta ignorada por git). **Nadie los ha escuchado todavía**: la validación es numérica.

Detalles que L2 (plugin C++) debe conocer:
- Formato `.jws` v1 idéntico al de MuldjordKit: zonas de 64 B, `lokey=hikey=nota`, capas de velocidad contiguas 1..127,
  round-robin por `rrIndex/rrCount` (el número de RR puede variar entre capas de una misma pieza), `oneShot=1` salvo toms (sordina).
- Hi-hat: cerrado 42 (`group 1`, `offBy 0`), pedal 44 (`group 1`), abierto 46 (`group 2`, `offBy 1`) y semiabierto en la **nota
  interna 100** (`group 2`, `offBy 1`), como MuldjordKit. Todos los kits de batería traen 42/44/46/100.
- **No todos los kits tienen todas las notas** (usa `kit.json.notas`): p. ej. falta 37 en `muldjord`/`drskit`, 52 en `virtuosity`/`drskit`,
  53 en `swirly`, 55 en varios. No hay fallback entre kits; el plugin debe consultar `notas` o caer al DSP modelado.
- Mono vs estéreo: `swirly` y `bigrusty` son **mono** (`channels=1`, +3 dB de compensación del pan como MuldjordKit); `virtuosity`,
  `naked`, `drskit` y `percusion` son estéreo en la mayoría de piezas (cada zona declara sus canales).
- Notas derivadas por afinación (muestras reales transpuestas con `tuneCents`): `naked` y `bigrusty` 35 = bombo -150 cents; toms
  extra (50, 48, 45...) a +-150..400 cents del tom real más cercano (`virtuosity`, `drskit`, `bigrusty`, `naked`); `percusion` 77
  (woodblock grave) = el mismo bloque -500 cents.
- Asignaciones que no son literales GM: `naked` 40 = segunda caja (Pearl Joey Jordison 13x6,5), no rimshot; `swirly` 40 = caja de
  escobilla en el borde y 37 = «dig» de escobilla (no hay cross-stick); `virtuosity` 55 = crash del ride plano (hace de splash),
  59 = ride plano, 57 = crash sizzle; `bigrusty` 57/59 = crash y ride «sizzle»; `drskit` 59 = hombro del ride y 40 = golpe en el
  aro (muy corto, 0,2 s).
- `percusion` incluye la campana de crash en la **nota 78** (Naked Drums, CC BY 4.0): por eso su `kit.json` declara `CC BY 4.0`
  y los créditos citan a Wilkinson Audio. Si se prefiere un `percusion` 100 % CC0, basta quitar la pieza `campana-crash` de
  `percusion2jws.py` y volver a generar.

Qué no se hizo / dificultades:
- **Timbales (65/66): sin muestras** (Virtuosity los trae sin micrófonos; VCSL no tiene). Tampoco cuíca (78/79 de GM), ni campana de
  crash en `swirly`/`bigrusty`/`virtuosity`, ni splash/china en `drskit`, ni cross-stick en `muldjord`/`drskit`.
- Unruly Drums (CC0) **no se convirtió**: la caja tiene decenas de capas por tamaño y no hay toms propios; haría falta un catálogo
  nuevo (los de plantilla `capas_tpl` de `kit_sfz2jws.py` sirven de base). DRSKit sí (port SFZ v1.0).
- Naked Drums: no se evalúan las macros ARIA; se leen `Data/group/*.txt` y `Data/file/*.txt` (el primer bloque de cada tecla es el
  golpe; los siguientes son chokes). Mezcla directo + overheads + sala cercana alineados por correlación (<= 6 ms). Sin chokes de
  platos ni hi-hat variable por CC.
- Virtuosity: solo micro `mid` (estéreo) + micros cercanos de bombo y caja (mono, alineados); sin `oh`/`room`/`lofi`. Caja centro +
  descentrada como 2 round-robin (el kit no trae RR de caja). Las otras fuentes de 48 kHz se remuestrean a 44,1 kHz.
- Swirly: sin ambientes `wet`/`wetter`. Sin campana de ride ni cross-stick real.
- Los kits mono no tienen imagen estéreo; si se quiere, añadir pan fijo por pieza (`dest[..].pan`).
- Una sola capa de velocidad (side-stick, campana, hi-hat pedal de `naked`, etc.) se normaliza a vel. 100 en vez de a la media del
  rango (si no, quedaba ~7 dB baja); en esas notas la dinámica sale solo de la curva del motor.
- Hay que **escuchar** los WAV (sobre todo toms transpuestos, bombo de `drskit`, el 77 del woodblock y la mezcla de `naked`) antes
  de ofrecer los kits en la interfaz.
- `plugins/samples/kits.json` (manifiesto con hash) de (e) no se ha creado.

Regenerar un kit: `python -I plugins/samples/tools/kit_sfz2jws.py <kit> <carpeta fuentes> [salida]` (ver el README). Fuentes
descargadas en `C:\Users\astac\AppData\Local\Temp\jw-drum-fuentes` (zips en `dl/`, descomprimidos en `x/<kit>`; VCSL por URL raw en
`vcsl/files`; FreePats World en `worldperc`; body_percussion en `x/body`).

### L2 plugin — selector de kits y percusión auxiliar en Worship Drums (29-10-2026, agente L2)

**Estado: implementado, compilado y probado; NO desplegado, NO commiteado.** Binario compilado (solo en el build, sin copiar a ninguna
carpeta VST3 que escanee la app): `plugins\build_worship-drums\VST3\Release\JasWaveWorshipDrums.vst3`
(`...\Contents\x86_64-win\JasWaveWorshipDrums.vst3`). Para probarlo en la app hay que desplegarlo con `plugins/deploy_vst3.ps1`
(ver la memoria «Plugins: ruta y despliegue»: la app cargaba compilaciones viejas).

Qué hace el plugin ahora
- **Parámetros nuevos (ids al final; los 0..22 y el FX Rack 100.. no cambian):** `23 Drum Kit` (lista de 16 posiciones, etiquetas = nombres de
  `kit.json`) y `24 Percusion Level` (-24..+6 dB, 0 por defecto). «Drum Kit» entra también en el modo Básico del editor.
- **Catálogo de kits** (`source/worship_drums_kits.h`, nuevo): `escanearKits()` lee `<samples>\drum-kits\<slug>\kit.json` (y comprueba que exista
  `<slug>.jws`) con un JSON mínimo propio (nombre, estilo, autor, licencia, enlaceLicencia, creditos, fuente, notas, tamanoMB). Orden de la lista:
  **muldjord primero** (banco histórico `worship-drums.jws`, que manda sobre la copia `drum-kits/muldjord`; de la copia solo se toman los metadatos),
  después el resto **por slug**, hasta 16. `percusion` no entra en la lista: es el banco de percusión. Con los 6 kits instalados por L1 el orden es
  muldjord, bigrusty, drskit, naked, swirly, virtuosity.
- **Servicio de carga `KitService`** (hilo persistente del motor; nada de E/S en el hilo de audio): el hilo de audio solo escribe átomos
  (`selectIndex`); el servicio escanea, carga el banco con la caché `acquireBank` y lo publica en los samplers con `Sampler::setBank` (intercambio
  atómico). **Cambio de kit sin clics ni cortes**: cada voz retiene su `shared_ptr` al banco con el que nació, así que las voces en curso terminan con el
  banco anterior y los golpes nuevos usan el nuevo (prueba K4: salida idéntica, dif. máx. 0, y redoble con cambio de kit cada 0,125 s sin clics).
  Las peticiones seguidas se funden. El banco de percusión se carga **en paralelo** (una vez). Se vuelve a escanear al activar el plugin (`resetDsp`) y
  con `engine.kits().refresh()`.
- **Kit inexistente / sin banco:** índice fuera de la lista → estado «NoExiste» y se conserva el kit cargado; banco corrupto → «ErrorCarga» y se conserva
  el anterior; ningún kit instalado → motor modelado exactamente como antes (prueba K1). La UI lo muestra (KIT / BANCO en el mini-panel).
- **Persistencia:** además del parámetro, el kit se guarda **por slug** en un bloque extra del estado (`JWXE`, tras los pares id/valor; ganchos nuevos
  `saveExtraState`/`loadExtraState` en `shared-dsp/jw_vst3.h`, vacíos por defecto: el resto de plugins no cambia de estado). Al abrir un proyecto manda
  el slug sobre el índice del parámetro (el orden de la lista cambia al instalar o quitar kits); después manda el parámetro. Los estados antiguos sin
  bloque cargan igual (host_test lo comprueba). Limitación conocida: si el orden cambió, el selector muestra la etiqueta del índice guardado hasta que
  el usuario lo toque.
- **Percusión auxiliar** (`auxNoteOn`): notas 39, 54, 56, 58 y 60..87 (palmas, pandereta, cencerro, vibraslap, bongós, congas, timbales, agogó, cabasa,
  shaker/maracas, güiro, claves, woodblock, triángulo...). Primero el banco del **kit** (si trae esa pieza) y si no el banco `percusion`; nivel propio
  (**Percusion Level**), pan fijo por pieza (`noteOnShaped`), bus propio `kBusPerc` con paso-altos de 70 Hz y envíos directo/overheads/sala como el resto
  de piezas (0,85 / 0,40 / 0,60). Choke por los grupos de las zonas del banco (triángulo 80/81 y hi-hat del kit 42/44/46/100, probados). Sin banco de
  percusión esas notas callan (como antes).
- **Campanas:** 53 (ride) y 78 (crash) → muestra real del kit; si no, la 78 cae al banco `percusion`; si tampoco, **modelo físico de platos en modo
  campana** (la 53 ya lo usaba; la 78 es la misma campana, más grave y más larga). Nunca falta (pruebas K1 y K7).
- **Calibración de caja y toms:** Shell Body/Shell Punch (EQ, capa sintetizada, curva de velocidad, compresión paralela) están medidos con MuldjordKit
  (fundamentales de toms, hueco de la caja a 160 Hz). **Con cualquier otro kit se apagan solos** (el banco suena tal cual y la compensación de nivel de
  caja y toms se anula); con muldjord todo igual que antes. Se recalcula al publicarse el banco (`kitMd_`, solo coeficientes).
- **UI** (`worship_drums_plugin.cpp`, `ui-layout.json`, `layouts.json` web regenerado): desplegable **KIT** y mando pequeño **PERC** en la sección de
  controles; cabecera del visualizador con «nombre · estilo» del kit activo; dos filas de casillas con las piezas del kit (KICK, SNARE, SIDE, RIM, TOMS,
  HAT, PEDAL, OPEN, RIDE, R.BELL, CRASH, C.BELL, SPLSH, CHINA) y de la percusión (CLAPS, TAMB, COWBL, VIBSL, BONGO, CONGA, TIMBL, AGOGO, CABAS, SHAKR,
  GUIRO, CLAVE, WOOD, TRIAN): encendida = hay muestra real (máscara de notas del banco cargado + percusión; mientras carga, vista previa por `kit.json`);
  lecturas KIT y BANCO (OK nn MB / CARGANDO / MODELADO / NO EXISTE / ERROR) en el mini-panel. La tabla de parámetros referencia las etiquetas de
  `kitLabels()` (se actualizan al escanear; antes del primer escaneo son «Kit n»). No se tocaron las capturas versionadas de `capturas/`.
- **Manifiesto** `jaswave-plugin.json`: parámetros `drum_kit` (id 23, enum) y `percussion_level` (id 24); `ai.intents` nuevos (`elegir-kit-bateria`,
  `kit-jazz`, `kit-rock`, `kit-pop`, `kit-escobillas`, `kit-indie`, `kit-vintage-metal`, `bateria-con-percusion`, `percusion-latina`, `campana-ride`,
  `campana-crash`, `nivel-percusion`); descripción y `ai.summary` con el mapa GM de la percusión. El manifiesto de este plugin **no** está en
  `sync-manifests.mjs` (se mantiene a mano; `--only worship-drums` no lo regenera). Manual de usuario (`docs/manual-usuario/07-vst-e-instrumentos.md`) ampliado.

Archivos tocados: `plugins/com.jaswave.plugin.worship-drums/source/worship_drums_kits.h` (nuevo), `source/worship_drums_dsp.h`,
`source/worship_drums_plugin.cpp`, `test/render_test.cpp`, `test/host_test.cpp`, `jaswave-plugin.json`, `ui-layout.json`;
`plugins/shared-dsp/jw_vst3.h` (ganchos de estado extra, aditivos); `plugins/com.jaswave.modulo.editores-vst/src/generado/layouts.json` (solo la
entrada de worship-drums, `ui-layout.mjs --solo-web`); `docs/manual-usuario/07-vst-e-instrumentos.md`. No se tocó `plugins/samples/` ni los documentos de licencias.

Pruebas (todas OK; compilado en `plugins/build_worship-drums`; validator VST3 **47/47**)
- `JasWaveWorshipDrums_rendertest.exe --kits` (también dentro de la suite modelada): bancos **sintéticos** (senos con caída, mismo formato `.jws` y
  estructura `drum-kits/<slug>/` + `kit.json`, en una carpeta temporal): enumeración, orden y etiquetas, kit por defecto, cambio en caliente sin clics,
  kit inexistente, slug guardado, las notas de percusión con su frecuencia, campanas (real, banco de percusión y modelo), Percusion Level -12 dB (medido
  -11,3 dB), pan, envío a sala, choke de hi-hat (antes y después de cambiar de kit) y de triángulo, CPU y polifonía (60 golpes/s de kit + percusión:
  7-10 % de un núcleo, 49 voces, pico 0,92), refrescar con kit nuevo o retirado, y el bus que lee el editor.
- `--kits-reales [carpeta]` (nuevo, no entra en CI): groove de 2 compases con percusión sobre cada kit **real** instalado; escribe
  `out/kits-plugin/<slug>-plugin-groove.wav`. Resultado: los 6 kits finitos, picos 0,87-0,92, RMS entre -20,2 y -18,9 dBFS (±0,8 dB entre kits), CPU
  2,3-3,2 %. Notas del kit sin muestra que suenan modeladas: 37 (muldjord, naked...), 55 (bigrusty, drskit), 52 (drskit, virtuosity), 53 (swirly). Percusión
  que calla: 65 (timbales).
- `--samples` (banco real MuldjordKit) y la suite modelada completas: 0 fallos. Los umbrales de CPU de esas suites dependen del estado de la máquina:
  se vieron hasta 9 % en el groove denso con el equipo cargado, igual que con el binario anterior compilado desde HEAD; en calma 4,7 %.
  `host_test`: estado antiguo y estado con slug, ida y vuelta idénticos. Ajustes de pruebas existentes: 23→25 parámetros propios y las notas de percusión
  auxiliar ya no se exigen mudas (suenan si hay banco `percusion`).

Pendiente / a tener en cuenta
1. **Escuchar** los WAV `out/kits-plugin/*-plugin-groove.wav` y los de L1 (`out/kits/`) antes de ofrecer los kits al usuario; el plugin solo se ha medido.
2. Desplegar el `.vst3` (`deploy_vst3.ps1`) cuando la prueba con la app en curso lo permita y comprobar en la app real que el desplegable muestra los nombres.
3. La IA elige kit por **posición** (`drum_kit`), no por estilo: el orden es muldjord + alfabético por carpeta. Hace falta que el agente lea los nombres y estilos
   del selector o que el módulo de IA tenga una tabla estilo→kit (jazz = `virtuosity`, rock/pop = `naked`, escobillas/indie = `swirly`, vintage/metal =
   `bigrusty`, jazz-rock = `drskit`) y calcule la posición. Una mejora sería exponer slug y estilo como salida del plugin (no hecho).
4. No hay botón «refrescar» en la UI: la lista se relee al activar el plugin. La réplica web (worklet) no usa kits ni percusión (solo recibe el layout nuevo).
5. Los kits mono (`swirly`, `bigrusty`) no tienen imagen estéreo propia; hay pan fijo por pieza de percusión pero no pan por kit.
6. Timbales (65/66) y cuíca siguen sin muestras (L1); la campana de crash 78 solo trae muestra real en `naked` y `percusion`, en el resto cae a `percusion` o al modelo.
7. CPU: con 60 golpes/s de kit + percusión el plugin usa 7-10 % de un núcleo (cada familia de samplers tiene 64 voces); no se tocó la política de polifonía.
