# ADR-0001: Estructura del Proyecto

## Contexto

Necesitamos una estructura de carpetas que soporte:
- Separación clara entre lógica de dominio, UI, servicios y comunicación IPC
- Tipado estricto en TypeScript
- Escalabilidad a medida que crece el proyecto
- Facilidad de testing
- Separación entre proceso principal, preload y renderizado de Electron

## Decisión

Adoptar la siguiente estructura de carpetas:

```
src/
├── main/                 # Proceso principal de Electron
│   ├── index.ts
│   ├── ipc/
│   │   ├── handlers/     # Manejadores de IPC
│   │   └── channels.ts   # Definición de canales IPC tipados
│   ├── services/
│   │   ├── project.service.ts
│   │   ├── audio.service.ts
│   │   └── ai.service.ts
│   └── native-bridge/    # Comunicación con motor nativo
│       └── bridge.ts
├── preload/              # Script de preload
│   └── index.ts
├── renderer/             # Proceso de renderizado (UI)
│   ├── index.tsx
│   ├── app/
│   │   ├── components/   # Componentes React
│   │   ├── panels/       # Paneles de la UI
│   │   ├── hooks/        # Custom hooks
│   │   ├── stores/       # Estado local de UI
│   │   └── styles/       # Estilos globales
│   └── utils/
├── domain/               # Lógica de dominio pura
│   ├── project/
│   ├── transport/
│   ├── tracks/
│   ├── clips/
│   ├── plugins/
│   ├── automation/
│   ├── routing/
│   └── analysis/
├── ai/                   # AI Harness
│   ├── harness/
│   ├── context/
│   ├── memory/
│   ├── tools/
│   ├── permissions/
│   ├── validation/
│   └── providers/
├── audio/                # Motor de audio (C++, futuro)
│   ├── engine/
│   ├── dsp/
│   ├── plugins/
│   └── analysis/
└── shared/               # Código compartido entre procesos
    ├── types/
    ├── events/
    ├── commands/
    └── utils/
```

## Consecuencias

### Positivas
- Separación clara de responsabilidades por proceso
- Lógica de dominio pura testeable sin Electron
- IPC centralizado y tipado
- Facilita la implementación en C++ para el motor de audio

### Negativas
- Duplicación leve de tipos entre procesos (mitigado con `shared/`)
- Curva de aprendizaje para desarrolladores nuevos
- Más archivos que una estructura plana

### Riesgos
- Si `shared/` crece demasiado, puede acoplarse indebidamente
- Mitigación: revisar dependencias de `shared/` periódicamente
