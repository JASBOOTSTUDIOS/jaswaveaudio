# ADR-0018: Soporte VST2 se mantiene

**Estado:** sustituida por [ADR-0019](ADR-0019-retiro-de-vst2.md) · **Fecha:** 2026-10-19 · **Decide:** JASBOOTSTUDIOS (propietario)

## Contexto

El plugin host nativo (`native/plugin-host`, ver ADR-0011) carga plugins **VST3** mediante el
Steinberg VST3 SDK v3.8.1_build_84 (licencia MIT desde la versión 3.8) y plugins **VST2 x64**
mediante `src/vst2_slot.cpp`.

Steinberg dejó de licenciar el VST2 SDK en 2018: ya no firma nuevos acuerdos de licencia VST2 y
no permite redistribuir los archivos de ese SDK. Muchos usuarios siguen teniendo plugins VST2
(gratuitos, antiguos o sin versión VST3), y poder cargarlos es una expectativa habitual en un DAW.

Para no depender del SDK, el repositorio contiene una cabecera mínima propia,
`native/plugin-host/vendor/vst2/aeffect.h`, escrita a mano, que declara solo las estructuras,
opcodes y constantes de la interfaz binaria VST 2.4 que el host necesita.

## Decisión

**Se mantiene el soporte VST2** en el plugin host, aceptando el riesgo legal residual descrito
abajo. El propietario toma esta decisión de forma consciente.

## Riesgo legal

- **Licencia/contrato:** sin acuerdo de licencia VST2 vigente, JASBOOTSTUDIOS no tiene permiso
  contractual de Steinberg para implementar VST2. El riesgo principal es una reclamación o
  solicitud de retirada por parte de Steinberg, y que tiendas o socios exijan retirar VST2.
- **Derechos de autor:** el riesgo se reduce al no copiar archivos del SDK; implementar una
  interfaz binaria para interoperar es una práctica extendida (otros hosts usan cabeceras
  reimplementadas), pero su tratamiento legal varía según la jurisdicción.
- **Marca:** el uso indebido de "VST" o de sus logotipos sí puede generar reclamaciones aunque
  el código sea propio.

Este análisis no es asesoramiento legal; debe revisarlo un abogado antes de una distribución
comercial amplia.

## Mitigaciones

1. **Ningún archivo del VST2 SDK de Steinberg** se versiona ni se distribuye (`aeffect.h` y
   `aeffectx.h` originales, `audioeffect.cpp`, etc.). Solo la cabecera mínima propia.
2. La cabecera propia contiene únicamente lo necesario para **hospedar** plugins VST2 que el
   usuario ya tiene instalados. JasWave **no crea ni distribuye plugins VST2**; los plugins
   propios (`native/jaswave-roles-vst`, `native/piano-synth`) son VST3.
3. El código VST2 está aislado en `vst2_slot.cpp` y la cabecera en `vendor/vst2/`, de modo que
   puede retirarse sin afectar al hosting VST3.
4. **Interruptor de compilación (pendiente):** añadir una opción CMake `JASWAVE_VST2`
   (por defecto `ON`) que, en `OFF`, excluya `vst2_slot.cpp` y `vendor/vst2` del build y haga
   que el descubrimiento ignore los `.dll` VST2. Permite publicar una build sin VST2 si un
   distribuidor o un requerimiento legal lo exige.
5. Los plugins de terceros son responsabilidad del usuario (ver `docs/legal/EULA.md` §4).
6. La cabecera y `THIRD_PARTY_NOTICES.md` documentan su origen y remiten a este ADR.

## Uso de la marca "VST"

"VST" es una marca registrada de Steinberg Media Technologies GmbH.

- Usar "VST3" y "VST2" solo de forma **descriptiva** para indicar compatibilidad
  ("carga plugins VST3 y VST2"), nunca como parte del nombre de JasWave ni de un producto propio.
- Incluir la atribución: *"VST es una marca registrada de Steinberg Media Technologies GmbH."*
  en la web, la tienda, la documentación y los avisos de la aplicación.
- **No usar el logotipo "VST"** ni el logotipo "VST Compatible". El logotipo VST3 solo puede
  usarse cumpliendo las directrices de uso de Steinberg para el VST3 SDK; para el logotipo VST2
  no existe vía de licencia, por lo que no debe usarse.
- No dar a entender afiliación, patrocinio o certificación de Steinberg.

## Consecuencias

- Los usuarios pueden seguir usando sus plugins VST2 x64.
- Existe un riesgo legal aceptado y documentado; si Steinberg o un socio lo solicita, la
  respuesta prevista es publicar builds con `JASWAVE_VST2=OFF`.
- Cualquier cambio en `vendor/vst2/` debe seguir siendo código propio y mínimo; está prohibido
  incorporar archivos del SDK original.
