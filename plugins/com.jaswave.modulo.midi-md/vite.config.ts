import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { configurarModulo } from '../sdk/host-sdk/src/vite'

export default defineConfig(configurarModulo({ raiz: __dirname, entrada: 'src/index.tsx', plugins: [tailwindcss()] }))
