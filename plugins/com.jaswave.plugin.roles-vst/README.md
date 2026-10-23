# JasWave Roles (VST3)

Instrumento estéreo por **rol musical** (batería, bajo, guitarra, piano, teclas, pad, cuerdas, coro, lead, metales,
synth, percusión, default) con envolvente, filtro, drive, gate y efectos (chorus/delay/reverb). Parámetro `Role` = id 0.

- Licencia: `com.jaswave.plugin.roles-vst` (features `roles.bateria`, `roles.efectos`), ver `../CONTRATO-V5.md`.
- Build independiente: `cmake -S . -B build -G "Visual Studio 18 2026" -A x64 && cmake --build build --config Release`
  (o todos los plugins desde `plugins/`). Bundle: `build/VST3/Release/JasWaveRoles.vst3`.
- FUID y IDs de parámetro conservados respecto a `native/jaswave-roles-vst` (estado previo compatible).
