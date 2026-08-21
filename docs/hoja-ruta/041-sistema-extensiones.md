# Sistema de Extensiones

## Objetivo
Implementar el sistema de extensiones/plugins del DAW: permitir a desarrolladores third-party extender el DAW con nuevas funcionalidades sin modificar el core.

## Criterios de Aceptación
- [ ] Sistema de extensiones/plugins del DAW
- [ ] API pública para desarrolladores
- [ ] Instalación/desinstalación de extensiones
- [ ] Marketplace de extensiones

## Requerimientos Detallados

### 1. Extension API
- API pública documentada para desarrolladores.
- Tipos y contratos estables.
- Ejemplos y plantillas de proyectos.
- Guía de desarrollo de extensiones.

### 2. Extension
Definir `Extension`:
- `id: string`
- `name: string`
- `version: string`
- `description: string`
- `author: string`
- `permissions: ExtensionPermission[]`
- `entryPoint: string`

### 3. Puntos de Extensión
- **Tools**: registrar nuevas herramientas.
- **Commands**: registrar nuevos comandos.
- **Panels**: agregar nuevos paneles a la UI.
- **Themes**: nuevos temas.
- **Presets**: bancos de presets.
- **File Formats**: soporte para nuevos formatos de import/export.
- **Analysis**: nuevos análisis de audio.

### 4. Instalación
- Instalar desde archivo `.jsext` (zip con metadata y código).
- Instalar desde URL.
- Validar firma digital (futuro).
- Aislar extensión en sandbox.
- Registrar en índice de extensiones.

### 5. Permisos
- `ExtensionPermission`:
  - `readState`
  - `writeState`
  - `executeCommands`
  - `registerTools`
  - `accessFileSystem`
  - `accessNetwork`
- El usuario concede permisos al instalar.
- Se pueden revocar permisos posteriormente.

### 6. Marketplace
- Catálogo de extensiones disponibles.
- Búsqueda y filtrado.
- Instalación con un click.
- Reseñas y calificaciones.
- Actualizaciones automáticas.

### 7. Ciclo de Vida
- Instalar → Habilitar → Ejecutar → Actualizar → Deshabilitar → Desinstalar.
- Las extensiones se cargan al iniciar el DAW.
- Si una extensión falla, se deshabilita automáticamente.

### 8. Tests
- Test: instalar extensión la registra
- Test: desinstalar extensión la elimina
- Test: extensión puede registrar herramienta
- Test: permisos se aplican correctamente
- Test: extensión con error se deshabilita
- Test: marketplace lista extensiones

## Dependencias
- Command System
- Tool Registry
- Event Bus
- State Model

## Documentación Relacionada
- `docs/arquitectura/VISION-GENERAL.md`
- `docs/arquitectura/SISTEMA-COMANDOS.md`
