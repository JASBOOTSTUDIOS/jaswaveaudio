# Métricas de Éxito

## Objetivo
Definir métricas medibles para evaluar el éxito del proyecto. Estas métricas se revisan en cada hito.

## Métricas

### Rendimiento de Audio
- **Latencia total**: < 10ms en configuraciones medias.
- **Xruns**: 0 xruns en sesiones de 4+ horas con configuración recomendada.
- **CPU**: < 70% de uso en proyecto medio (20 tracks, 10 plugins).
- **Estabilidad**: Sin crashes en sesiones de 4+ horas.

**Cómo medir**:
- Latencia: medir round-trip desde entrada hasta salida.
- Xruns: contar eventos de buffer underrun/overrun.
- CPU: monitorear uso del audio thread.
- Crashes: contar crashes reportados por usuarios.

### IA
- **Latencia de consulta**: < 2s para respuestas de lectura.
- **Latencia de ejecución**: < 500ms para ejecución de herramientas.
- **Precisión**: > 90% de tool calls exitosos en primer intento.
- **Context overflow**: < 5% de interacciones exceden token budget.

**Cómo medir**:
- Latencia: medir desde envío de mensaje hasta respuesta.
- Tool calls: contar éxito/fallo por sesión.
- Context overflow: loguear cuando el contexto se trunca.

### UX
- **Tareas comunes**: < 3 clics para crear track, cargar plugin, iniciar playback.
- **Time to first sound**: < 30 segundos desde abrir el DAW hasta escuchar audio.
- **Accesibilidad**: Cumplir WCAG AA.
- **Satisfacción**: Encuesta NPS > 8/10.

**Cómo medir**:
- Tareas comunes: grabación de sesiones de usuario.
- Time to first sound: medir en testing.
- Accesibilidad: auditoría automatizada.
- Satisfacción: encuestas periódicas.

### Código
- **Cobertura de tests**: > 80% en módulos core (Event Bus, State Model, Command System, Validation).
- **Deuda técnica**: < 10% de código duplicado.
- **Tiempo de build**: < 5 minutos para build completo.
- **Tiempo de test**: < 2 minutos para test suite completa.

**Cómo medir**:
- Cobertura: reporte de cobertura en CI.
- Deuda técnica: análisis estático.
- Build/test: medir en CI.

### Audio
- **Calidad de render**: Distorsión < -60 dBFS.
- **Precisión de automatización**: Error < 0.1 dB.
- **Consistencia**: Mismo proyecto produce mismo audio en diferentes ejecuciones (determinismo).

**Cómo medir**:
- Calidad: análisis espectral del render.
- Precisión: comparar valores de automatización con valores esperados.
- Consistencia: hash de archivos de audio renderizados.

## Dashboard

- Métricas se recopilan automáticamente (opt-in).
- Dashboard accesible en Developer Tools.
- Alertas si métricas caen por debajo de umbrales.

## Revisiones

- Revisar métricas en cada hito.
- Si una métrica no se cumple, documentar causa y plan de corrección.
- Las métricas pueden ajustarse según feedback de usuarios.
