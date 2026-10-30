/**
 * Instala el runtime del SDK de módulos: el React del DAW (una sola instancia: contextos y hooks
 * compartidos) y su API pública (api-host.ts). Se llama una vez al arrancar, antes de cargar módulos.
 */

import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JsxRuntime from 'react/jsx-runtime'
import { instalarRuntime, VERSION_SDK } from '@jaswave/host-sdk/runtime'
import * as apiHost from './api-host'

let instalado = false

export function instalarSdkHost(): void {
  if (instalado) return
  instalado = true
  instalarRuntime({
    version: VERSION_SDK,
    react: { ...React },
    reactDom: { ...ReactDOM },
    reactDomClient: { ...ReactDOMClient },
    jsxRuntime: { ...JsxRuntime },
    api: { ...apiHost },
  })
}
