/**
 * Build de un módulo: librería ESM (`dist/modulo.js` + `dist/modulo.css`) que toma React y la API del
 * DAW del runtime del host (no los empaqueta). Uso en el vite.config.ts del módulo:
 *
 *   export default configurarModulo({ raiz: __dirname, entrada: 'src/index.tsx' })
 */

import { resolve } from 'node:path'
import type { UserConfig } from 'vite'

const SDK = resolve(__dirname)

export type OpcionesModulo = {
  raiz: string
  entrada: string
  /** Alias extra (p. ej. librerías del monorepo que el módulo empaqueta). */
  alias?: Record<string, string>
  plugins?: UserConfig['plugins']
}

export function configurarModulo(o: OpcionesModulo): UserConfig {
  return {
    root: o.raiz,
    plugins: o.plugins ?? [],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    resolve: {
      alias: [
        { find: /^react\/jsx-runtime$/, replacement: resolve(SDK, 'shims/react-jsx-runtime.ts') },
        { find: /^react\/jsx-dev-runtime$/, replacement: resolve(SDK, 'shims/react-jsx-runtime.ts') },
        { find: /^react-dom\/client$/, replacement: resolve(SDK, 'shims/react-dom-client.ts') },
        { find: /^react-dom$/, replacement: resolve(SDK, 'shims/react-dom.ts') },
        { find: /^react$/, replacement: resolve(SDK, 'shims/react.ts') },
        { find: /^@jaswave\/host-sdk$/, replacement: resolve(SDK, 'index.ts') },
        ...Object.entries(o.alias ?? {}).map(([find, replacement]) => ({ find, replacement })),
      ],
    },
    build: {
      outDir: resolve(o.raiz, 'dist'),
      emptyOutDir: true,
      cssCodeSplit: false,
      sourcemap: false,
      target: 'es2022',
      lib: { entry: resolve(o.raiz, o.entrada), formats: ['es'], fileName: () => 'modulo.js', cssFileName: 'modulo' },
      // Los import() dinámicos (p. ej. Mermaid) quedan en dist/chunks/ y solo se descargan cuando se usan.
      rollupOptions: { output: { chunkFileNames: 'chunks/[name]-[hash].js' } },
    },
  }
}
