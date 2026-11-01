import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { configurarModulo } from '../sdk/host-sdk/src/vite'

export default defineConfig(
  configurarModulo({
    raiz: __dirname,
    entrada: 'src/index.tsx',
    plugins: [tailwindcss()],
    // vexflow no exporta el subpath de la fuente Bravura.
    alias: { 'vexflow-bravura-font': resolve(__dirname, '../node_modules/vexflow/build/esm/src/fonts/bravura.js') },
  }),
)
