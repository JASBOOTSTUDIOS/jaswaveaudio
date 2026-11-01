# Conversores de kits de batería y percusión (Worship Drums)

Generan los bancos `.jws` de `%APPDATA%\JasWave\samples\drum-kits\<slug>\` (`<slug>.jws` + `kit.json`). **Los bancos no van en git.**
Todos usan el mismo tratamiento de audio que el banco MuldjordKit (`sfz2jws.py`: remuestreo a 44,1 kHz, DC fuera, recorte del
silencio inicial y final, fundidos, normalización por pieza con los mismos niveles, PCM 16 bits con dither TPDF).

| Script | Qué hace |
|---|---|
| `jws_kit_lib.py` | Biblioteca común (mezcla de micrófonos con alineación, capas de velocidad sin huecos, round-robin, escritura `.jws` v1 y `kit.json`). |
| `kit_sfz2jws.py KIT FUENTES [SALIDA]` | Baterías: `virtuosity`, `naked`, `swirly`, `bigrusty`, `drskit`, y `muldjord` (copia `worship-drums.jws` a `drum-kits/muldjord/` sin borrar el original). Cada kit tiene un catálogo (`cat_*`) con el mapeo pieza -> nota GM. |
| `percusion2jws.py FUENTES [SALIDA]` | Kit `percusion` (mapa GM 39-85) desde Virtuosity `perc/mid`, VCSL, FreePats World Percussion, body_percussion y la campana de crash de Naked Drums. |
| `jws_kit_validate.py CARPETA_KIT [CARPETA_WAV]` | Carga el `.jws` con la lógica de `jw_sampler.h`, comprueba zonas por nota, velocidades 1..127 sin huecos, round-robin completos, clipping, `kit.json`, y escribe `<slug>-golpes.wav` y `<slug>-groove.wav` en `plugins/com.jaswave.plugin.worship-drums/out/kits/` (ignorada por git). |

## Uso

```bash
# Fuentes: cada zip en su carpeta x/<kit> (descomprimidas); VCSL en vcsl/files/...; FreePats World en worldperc/
python -I kit_sfz2jws.py virtuosity  C:/ruta/jw-drum-fuentes  C:/ruta/salida/drum-kits
python -I kit_sfz2jws.py naked       C:/ruta/jw-drum-fuentes  C:/ruta/salida/drum-kits
python -I percusion2jws.py C:/ruta/jw-drum-fuentes C:/ruta/salida/drum-kits/percusion
python -I jws_kit_validate.py C:/ruta/salida/drum-kits/virtuosity
```

Requisitos: Python 3.11 con `numpy`, `scipy` y `soundfile`. Ejecutar siempre con `-I` y desde fuera de las carpetas de fuentes
(las descargas son datos no confiables; los scripts nunca ejecutan nada que venga en ellas).

Fuentes y URL: ver `docs/plans/L-baterias-reales.md` y `plugins/samples/LICENCIAS-SAMPLES.md`.
