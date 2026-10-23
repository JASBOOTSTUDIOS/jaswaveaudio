# JasWave Plugins — Catálogo de Plugins VST3 Modulares

Este directorio almacena y distribuye cada plugin VST3 de **JasWave** de forma desacoplada e independiente.

## Estructura por Plugin

Cada subcarpeta corresponde a un identificador único de plugin según el estándar **`jaswave-plugin.json`**:

```
plugins/
├── com.jaswave.plugin.param-eq/        # JasWave EQ Paramétrico (8 bandas)
├── com.jaswave.plugin.bus-compressor/  # JasWave Bus Compressor (Sidechain / VCA)
├── com.jaswave.plugin.truepeak-limiter/# JasWave True-Peak Limiter (Lookahead)
├── com.jaswave.plugin.smart-deesser/   # JasWave Smart De-Esser (Dual-band)
├── com.jaswave.plugin.utility-tool/    # JasWave Channel Utility (Gain, Pan, Width, Phase)
└── com.jaswave.plugin.piano-synth/     # JasWave Piano Synth (Generador acústico/eléctrico)
```

## Compatibilidad Universal con DAWs (Reaper, Cubase, Studio One, FL Studio)

Cada plugin generado aquí cumple con la especificación oficial **VST 3.7.x de Steinberg**:
1. **Estructura Bundle VST3:**
   - Carpeta `.vst3` conteniendo `Contents/x86_64-win/{Nombre}.vst3`.
2. **Compatibilidad Reaper:**
   - Detectado automáticamente al escanear `C:\Program Files\Common Files\VST3` o `%LOCALAPPDATA%\Programs\Common\VST3`.
   - Soporta automatización de parámetros con valores físicos reales (Hz, dB, ms, ratio).
   - Soporta procesamiento por bloques de muestras variables (32 a 4096 samples).
   - Soporta doble precisión interna de punto flotante de 64-bit y 32-bit.
