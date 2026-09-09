# 13 · Terminal

La **Terminal** es una herramienta del workspace (panel inferior, rail, o ventana suelta). No es PowerShell de Windows: es la **CLI de JasWave**, con varias sesiones (`+`, split, papelera) como en un IDE.

Abre con **Ver → Terminal** o `Ctrl+`` .

Escribe `ayuda` para esta misma lista.

## Comandos básicos (español)

| Comando | También vale | Qué hace |
|---------|--------------|----------|
| `ayuda` | `help`, `?` | Muestra esta ayuda |
| `limpiar` | `clear`, `cls` | Vacía la pantalla |
| `donde` | `pwd` | Carpeta actual |
| `ir [ruta]` | `cd` | Cambia de carpeta (`ir ..`, `cd /`, `cd pistas`) |
| `listar` | `ls`, `dir` | Contenido de la carpeta |
| `eco <texto>` | `echo` | Imprime texto |
| `fecha` | `hora`, `date` | Fecha y hora |
| `historial` | `history` | Comandos de esta sesión |
| `quien` | `whoami` | Identidad (`jaswave`) |
| `salir` | `exit` | No cierra el DAW; usa la papelera de la pestaña |

## Transporte y proyecto

| Comando | También vale | Qué hace |
|---------|--------------|----------|
| `reproducir` | `play` | Play |
| `pausar` | `pause` | Pausa |
| `detener` | `parar`, `stop` | Stop |
| `buscar <s>` | `seek` | Ir a un tiempo en segundos |
| `estado` | `state` | Resumen del proyecto (JSON) |
| `pistas` | | Lista pistas |
| `bpm <n>` | `project.setBpm <n>` | Cambia el tempo |

## Carpetas virtuales

No hay disco aquí. El prompt muestra una ruta del **proyecto**:

```
jaswave />
jaswave /pistas>
jaswave /pistas/Batería>
```

| Ruta | `listar` muestra |
|------|------------------|
| `/` | `pistas/`, `transporte/`, `mixer/` |
| `/pistas` | nombres de pistas |
| `/pistas/<nombre>` | clips de esa pista |
| `/transporte` | play / BPM / posición |
| `/mixer` | volumen por pista |

### Ejemplos

```text
ayuda
ir pistas
listar
cd ..
limpiar
reproducir
bpm 72
eco hola
```

## Acciones DAW (avanzado)

```text
list
list track
action track.create {"nombre":"Batería","tipo":"midi"}
project.setBpm 72
```

`list` (inglés, una palabra) es el catálogo de acciones. `listar` es el contenido de la carpeta.

## Acciones del asistente

Cuando el asistente llama herramientas (`track.delete`, `planner.preview`, …), esas líneas se copian aquí con `ok` / `fail` a la derecha. El chat y la Terminal muestran el mismo log.

La primera acción nueva abre la pestaña Terminal (abajo). `limpiar` solo vacía la pantalla; las siguientes acciones siguen apareciendo.

## Varias ventanas

- **+** nueva sesión
- **Split** dos terminales lado a lado
- **Papelera** cierra la sesión activa
- Arrastra la pestaña **Terminal** a otro panel o ábrela en otra ventana

Siguiente: [01 · Primeros pasos](./01-primeros-pasos.md) si acabas de llegar, o [08 · Asistente](./08-asistente-y-prompts.md).
