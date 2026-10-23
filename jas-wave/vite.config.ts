import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'path'

/**
 * Orígenes del backend (API + WebSocket de sincronización) y de Supabase Auth que el renderer
 * puede contactar. Se fijan en build desde VITE_API_URL / VITE_SUPABASE_URL; nada más sale fuera.
 */
export function origenesBackend(env: Record<string, string>): string[] {
  const out = new Set<string>()
  for (const clave of ['VITE_API_URL', 'VITE_SUPABASE_URL']) {
    const valor = env[clave]
    if (!valor) continue
    try {
      const u = new URL(valor)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue
      out.add(u.origin)
      out.add(`${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}`)
    } catch {
      // valor inválido: no se añade a la CSP
    }
  }
  return [...out]
}

/** Origen del API (VITE_API_URL): sirve los módulos del DAW a la web en /modulos (M3). */
export function origenModulosWeb(env: Record<string, string>): string[] {
  try {
    const u = new URL(env.VITE_API_URL ?? '')
    return u.protocol === 'http:' || u.protocol === 'https:' ? [u.origin] : []
  } catch {
    return []
  }
}

/**
 * CSP del renderer empaquetado (file://). Solo en build: en dev, Vite/HMR necesita
 * scripts inline y websocket. Todo es local salvo el backend y Supabase (origenesBackend).
 * Código de módulos: los instalados (jaswave-modulo:, verificados por el proceso main) y, en la web,
 * los publicados por el API (origenModulosWeb).
 */
const cspBase = (conectar: string[], modulos: string[]) => [
  "default-src 'self'",
  ["script-src 'self' jaswave-modulo:", ...modulos].join(' '),
  ["style-src 'self' 'unsafe-inline' jaswave-modulo:", ...modulos].join(' '),
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  ["connect-src 'self' data: blob: jaswave-modulo:", ...conectar].join(' '),
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(conectar: string[], modulos: string[]): Plugin {
  const CONTENT_SECURITY_POLICY = cspBase(conectar, modulos)
  return {
    name: 'jaswave-csp',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      )
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), tsconfigPaths(), contentSecurityPolicy(origenesBackend(loadEnv(mode, __dirname, 'VITE_')), origenModulosWeb(loadEnv(mode, __dirname, 'VITE_')))],
  publicDir: resolve(__dirname, 'public'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ['**/cli/**', '**/_*.mjs', '**/_*.json', '**/node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, ''),
      '@jaswave/ai-harness': resolve(__dirname, '../ai-harness/src/index.ts'),
      '@jaswave/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@jaswave/host-sdk': resolve(__dirname, '../plugins/sdk/host-sdk/src'),
      react: resolve(__dirname, 'node_modules/react'),
      'react-dom': resolve(__dirname, 'node_modules/react-dom'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['mermaid'],
  },
}))
