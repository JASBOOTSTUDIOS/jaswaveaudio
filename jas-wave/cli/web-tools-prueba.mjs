#!/usr/bin/env node
/**
 * Prueba manual de las herramientas web de la IA (K6) contra internet real, sin abrir la app.
 *
 *   node --import tsx cli/web-tools-prueba.mjs buscar "tempo de la bachata"
 *   node --import tsx cli/web-tools-prueba.mjs leer https://es.wikipedia.org/wiki/Bachata
 *   node --import tsx cli/web-tools-prueba.mjs yt "Romeo Santos Propuesta Indecente"
 *   node --import tsx cli/web-tools-prueba.mjs ficha https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *   node --import tsx cli/web-tools-prueba.mjs referencia https://www.youtube.com/watch?v=dQw4w9WgXcQ
 *
 * `referencia` usa el yt-dlp de %LOCALAPPDATA%\JasWave\tools\yt-dlp (lo descarga y verifica si falta) y el
 * ffmpeg de JasWave; deja el WAV en una carpeta temporal e imprime su ruta.
 */
import * as os from 'node:os'
import * as path from 'node:path'

const [comando, ...resto] = process.argv.slice(2)
const arg = resto.join(' ').trim()
const wt = await import('../electron/web-tools.ts')

const salir = (msg) => {
  console.error(msg)
  process.exit(1)
}
if (!comando || !arg) salir('Uso: web-tools-prueba.mjs <buscar|leer|yt|ficha|referencia> <texto o URL>')

const t0 = Date.now()
try {
  switch (comando) {
    case 'buscar': {
      const r = await wt.webBuscar(arg, { max: 6 })
      for (const [i, h] of r.entries()) console.log(`${i + 1}. [${h.fuente}] ${h.titulo}\n   ${h.url}\n   ${h.resumen}`)
      break
    }
    case 'leer': {
      const p = await wt.webLeer(arg, { maxChars: 3000 })
      console.log(JSON.stringify({ ...p, texto: undefined }, null, 2))
      console.log('----\n' + p.texto)
      break
    }
    case 'yt': {
      const v = await wt.youtubeBuscar(arg, { max: 6 })
      for (const [i, x] of v.entries()) console.log(`${i + 1}. ${x.titulo} — ${x.canal} (${x.duracion})\n   ${x.url}`)
      break
    }
    case 'ficha': {
      const f = await wt.youtubeFicha(arg)
      console.log(JSON.stringify({ ...f, transcripcion: f.transcripcion ? `${f.transcripcion.slice(0, 300)}…` : undefined, descripcion: f.descripcion.slice(0, 300) }, null, 2))
      break
    }
    case 'referencia': {
      const { resolverFfmpeg } = await import('../electron/audio-encoder.ts')
      const localAppData = process.env.LOCALAPPDATA || os.homedir()
      const ffmpeg = await resolverFfmpeg({ localAppData, env: process.env })
      if (!ffmpeg) salir('ffmpeg no está instalado (instálalo desde Exportar → MP3 o añádelo al PATH)')
      let ytDlp = await wt.resolverYtDlp({ localAppData, env: process.env })
      if (!ytDlp) {
        console.log('Descargando yt-dlp (verificado con SHA2-256SUMS)…')
        ytDlp = { ruta: await wt.instalarYtDlp({ localAppData, alProgreso: (r) => process.stdout.write(`\r${Math.round(r / 1024 / 1024)} MB`) }), origen: 'jaswave' }
        console.log(`\ninstalado en ${ytDlp.ruta}`)
      }
      const carpeta = path.join(os.tmpdir(), 'jaswave-referencias-prueba')
      const ref = await wt.extraerReferenciaAudio(arg, { carpeta, ytDlp: ytDlp.ruta, ffmpeg: ffmpeg.ruta, alProgreso: (fase, d) => console.log(`[${fase}] ${d ?? ''}`) })
      console.log(JSON.stringify({ ...ref, pcm: `${ref.pcm.length} muestras` }, null, 2))
      break
    }
    default:
      salir(`Comando desconocido: ${comando}`)
  }
  console.log(`\n(${Date.now() - t0} ms)`)
} catch (e) {
  salir(`ERROR: ${e instanceof Error ? e.message : String(e)}`)
}
