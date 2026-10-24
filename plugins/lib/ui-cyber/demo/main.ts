/**
 * Demostración de @jaswave/ui-cyber con los layouts reales de los 7 VST (sin el DAW): sirve para revisar
 * el diseño y para las pruebas en navegador (responsivo, táctil).  npx vite plugins/lib/ui-cyber/demo
 */
import eq from '../../../com.jaswave.plugin.param-eq/ui-layout.json'
import comp from '../../../com.jaswave.plugin.bus-compressor/ui-layout.json'
import lim from '../../../com.jaswave.plugin.truepeak-limiter/ui-layout.json'
import de from '../../../com.jaswave.plugin.smart-deesser/ui-layout.json'
import util from '../../../com.jaswave.plugin.utility-tool/ui-layout.json'
import piano from '../../../com.jaswave.plugin.piano-synth/ui-layout.json'
import roles from '../../../com.jaswave.plugin.roles-vst/ui-layout.json'
import { EditorCyber, PESTANAS, defDe, modoPorAncho, normalizadoPorDefecto, vistaDe, type Pestana, type UiLayout } from '../src'

const LAYOUTS: Record<string, UiLayout> = { eq, comp, lim, de, util, piano, roles } as unknown as Record<string, UiLayout>
const q = new URLSearchParams(location.search)
let actual = q.get('plugin') && LAYOUTS[q.get('plugin')!] ? q.get('plugin')! : 'eq'
let pestana: Pestana = (q.get('pestana') as Pestana) || 'controles'
const valores = new Map<number, number>()
const cambios: Array<{ param: number; n: number; fase: string }> = []
;(window as unknown as { __cambios: typeof cambios }).__cambios = cambios

const lienzo = document.getElementById('lienzo') as HTMLCanvasElement
const contenedor = document.getElementById('contenedor')!
const layout = () => LAYOUTS[actual]!
const valor = (p: number) => {
  if (valores.has(p)) return valores.get(p)!
  const w = layout().widgets.find((x) => x.param === p)
  const d = w ? defDe(w) : null
  return d ? normalizadoPorDefecto(d) : 0
}
// espectro de prueba: ruido rosa con algunos armónicos, que se mueve un poco
const cols = new Float32Array(192)
const espectro = () => {
  const t = performance.now() / 1000
  for (let i = 0; i < cols.length; i++) cols[i] = -42 - i * 0.12 + 6 * Math.sin(i * 0.45 + t * 3) * Math.sin(i * 0.07) + (i % 23 === 0 ? 14 : 0)
  return { in: cols.map((v) => v + 3), out: cols }
}

let editor = crear()
function crear(): EditorCyber {
  return new EditorCyber(lienzo, {
    layout: layout(),
    valor,
    cambiar: (param, n, fase) => {
      if (fase !== 'fin') valores.set(param, n)
      cambios.push({ param, n, fase })
    },
    espectro,
    avisoMedicion: 'Demostración de @jaswave/ui-cyber: la medición en vivo la calcula el VST en escritorio.',
  })
}

function barra() {
  const b = document.getElementById('barra')!
  b.innerHTML = ''
  for (const k of Object.keys(LAYOUTS)) {
    const boton = document.createElement('button')
    boton.textContent = LAYOUTS[k]!.titulo
    boton.setAttribute('aria-pressed', String(k === actual))
    boton.onclick = () => {
      actual = k
      editor.destruir()
      valores.clear()
      editor = crear()
      barra()
      ajustar()
    }
    b.appendChild(boton)
  }
}

function ajustar() {
  const ancho = contenedor.clientWidth
  const modo = modoPorAncho(ancho)
  document.body.dataset.modo = modo
  const pes = document.getElementById('pestanas')!
  pes.innerHTML = ''
  if (modo === 'pestanas') {
    for (const p of PESTANAS) {
      const t = document.createElement('button')
      t.textContent = p.titulo
      t.setAttribute('role', 'tab')
      t.setAttribute('aria-selected', String(p.id === pestana))
      t.onclick = () => {
        pestana = p.id
        ajustar()
      }
      pes.appendChild(t)
    }
  }
  editor.fijarVista(vistaDe(layout(), modo, pestana))
  editor.redimensionar(ancho)
}

barra()
new ResizeObserver(ajustar).observe(contenedor)
ajustar()
let ultimo = performance.now()
const bucle = (t: number) => {
  editor.dibujar((t - ultimo) / 1000)
  ultimo = t
  requestAnimationFrame(bucle)
}
requestAnimationFrame(bucle)
