import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { createHash } from 'node:crypto'
import {
  binarioYtDlp,
  elegirPistaSubtitulos,
  esIpPrivada,
  extraerCapitulos,
  extraerJsonVariable,
  extraerTextoLegible,
  extraerVideoId,
  fetchSeguro,
  hostPermitido,
  instalarYtDlp,
  LimitadorPeticiones,
  parsearBusquedaWikipedia,
  parsearFichaYoutube,
  parsearResultadosDdg,
  parsearResultadosYoutube,
  parsearSumasSha256,
  parsearTimedText,
  parsearWavMono16,
  resolverYtDlp,
  segundosDesdeTexto,
  urlEmbedYoutube,
  validarUrlPublica,
  validarUrlResuelta,
  ventanaMasDensa,
  wavMono16,
  webBuscar,
  webLeer,
  youtubeFicha,
} from './web-tools'

const publico = async () => ['93.184.216.34']

function respuesta(cuerpo: string | Buffer, init: { status?: number; tipo?: string; location?: string } = {}): Response {
  const headers = new Headers()
  if (init.tipo) headers.set('content-type', init.tipo)
  if (init.location) headers.set('location', init.location)
  return new Response(cuerpo, { status: init.status ?? 200, headers })
}

/** fetch falso por URL (prefijo). */
function fetchFalso(rutas: Record<string, (url: string) => Response>): typeof fetch {
  const llamadas: string[] = []
  const f = (async (entrada: RequestInfo | URL) => {
    const url = String(entrada)
    llamadas.push(url)
    const clave = Object.keys(rutas).find((k) => url.startsWith(k))
    if (!clave) return respuesta('no encontrado', { status: 404 })
    return rutas[clave]!(url)
  }) as unknown as typeof fetch & { llamadas: string[] }
  ;(f as { llamadas: string[] }).llamadas = llamadas
  return f
}

describe('web-tools · validación de URLs', () => {
  it('bloquea IPs privadas, loopback, enlace local, metadata y mapeadas', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', 'fc00::abcd', '::ffff:127.0.0.1', '::ffff:7f00:1', 'ff02::1', '224.0.0.1']) {
      assert.equal(esIpPrivada(ip), true, ip)
    }
    for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '2606:4700::1111', '::ffff:8.8.8.8']) assert.equal(esIpPrivada(ip), false, ip)
  })

  it('solo http(s) públicas, sin credenciales ni nombres internos', () => {
    assert.equal(validarUrlPublica('https://es.wikipedia.org/wiki/Bachata').hostname, 'es.wikipedia.org')
    assert.throws(() => validarUrlPublica('file:///C:/Windows/system.ini'), /http\(s\)/)
    assert.throws(() => validarUrlPublica('ftp://ejemplo.com/x'), /http\(s\)/)
    assert.throws(() => validarUrlPublica('http://localhost:5173/'), /Host no permitido/)
    assert.throws(() => validarUrlPublica('http://127.0.0.1/'), /privada/)
    assert.throws(() => validarUrlPublica('http://[::1]/'), /privada/)
    assert.throws(() => validarUrlPublica('http://169.254.169.254/latest/meta-data'), /privada/)
    assert.throws(() => validarUrlPublica('http://metadata.google.internal/'), /Host no permitido/)
    assert.throws(() => validarUrlPublica('http://servidor.local/'), /Host no permitido/)
    assert.throws(() => validarUrlPublica('http://user:pass@ejemplo.com/'), /credenciales/)
    assert.throws(() => validarUrlPublica(''), /Falta/)
    assert.throws(() => validarUrlPublica(`https://e.com/${'a'.repeat(2100)}`), /larga/)
  })

  it('rechaza hosts que resuelven a direcciones privadas (rebinding)', async () => {
    await assert.rejects(validarUrlResuelta('https://trampa.example', async () => ['8.8.8.8', '10.0.0.5']), /privada/)
    await assert.rejects(validarUrlResuelta('https://nadie.example', async () => []), /ninguna/)
    assert.equal((await validarUrlResuelta('https://ok.example', publico)).hostname, 'ok.example')
  })

  it('hostPermitido acepta el host exacto y subdominios', () => {
    assert.equal(hostPermitido('www.youtube.com', ['youtube.com']), true)
    assert.equal(hostPermitido('youtube.com.evil.net', ['youtube.com']), false)
    assert.equal(hostPermitido('evilyoutube.com', ['youtube.com']), false)
  })
})

describe('web-tools · fetchSeguro', () => {
  it('sigue redirecciones validando cada salto y rechaza las que van a IPs privadas', async () => {
    const f = fetchFalso({
      'https://a.example/': () => respuesta('', { status: 302, location: 'https://b.example/final' }),
      'https://b.example/final': () => respuesta('<html>hola</html>', { tipo: 'text/html; charset=utf-8' }),
      'https://mal.example/': () => respuesta('', { status: 302, location: 'http://127.0.0.1:8080/admin' }),
      'https://bucle.example/': (u) => respuesta('', { status: 301, location: `${u}x` }),
    })
    const r = await fetchSeguro('https://a.example/', { fetch: f, resolver: publico })
    assert.equal(r.url, 'https://b.example/final')
    assert.equal(r.cuerpo, '<html>hola</html>')
    await assert.rejects(fetchSeguro('https://mal.example/', { fetch: f, resolver: publico }), /privada/)
    await assert.rejects(fetchSeguro('https://bucle.example/', { fetch: f, resolver: publico, maxRedirecciones: 3 }), /Demasiadas redirecciones/)
  })

  it('corta el cuerpo en maxBytes y lo marca como truncado', async () => {
    const f = fetchFalso({ 'https://grande.example/': () => respuesta('x'.repeat(5000), { tipo: 'text/plain' }) })
    const r = await fetchSeguro('https://grande.example/', { fetch: f, resolver: publico, maxBytes: 1000 })
    assert.equal(r.truncado, true)
    assert.equal(r.bytes.length, 1000)
  })

  it('respeta la lista de hosts permitidos', async () => {
    const f = fetchFalso({ 'https://otro.example/': () => respuesta('ok') })
    await assert.rejects(fetchSeguro('https://otro.example/', { fetch: f, resolver: publico, hostsPermitidos: ['github.com'] }), /fuera de la lista/)
  })
})

const DDG_HTML = `
<div class="results">
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title"><a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fes.wikipedia.org%2Fwiki%2FBachata&amp;rut=abc">Bachata - Wikipedia, la enciclopedia libre</a></h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fes.wikipedia.org%2Fwiki%2FBachata">La <b>bachata</b> es un g&eacute;nero musical bailable originario de Rep&uacute;blica Dominicana…</a>
  </div>
</div>
<div class="result result--ad">
  <a class="result__a" href="https://duckduckgo.com/y.js?ad_provider=bing">Anuncio</a>
</div>
<div class="result results_links web-result">
  <a class="result__a" href="https://www.ejemplo.com/tempo">Tempo de la bachata</a>
  <div class="result__snippet">Entre 120 y 130 BPM.</div>
</div>
</div>`

describe('web-tools · búsqueda', () => {
  it('parsea DuckDuckGo HTML: desenvuelve uddg, decodifica entidades y salta anuncios', () => {
    const r = parsearResultadosDdg(DDG_HTML)
    assert.equal(r.length, 2)
    assert.deepEqual(r[0], {
      titulo: 'Bachata - Wikipedia, la enciclopedia libre',
      url: 'https://es.wikipedia.org/wiki/Bachata',
      resumen: 'La bachata es un género musical bailable originario de República Dominicana…',
      fuente: 'duckduckgo',
    })
    assert.equal(r[1]!.url, 'https://www.ejemplo.com/tempo')
    assert.equal(r[1]!.resumen, 'Entre 120 y 130 BPM.')
  })

  it('parsea la API de Wikipedia y cae a ella cuando DDG falla', async () => {
    const json = { query: { search: [{ title: 'Bachata', snippet: 'Género <span class="searchmatch">musical</span>' }, { title: 'Merengue (música)', snippet: '' }] } }
    const w = parsearBusquedaWikipedia(json)
    assert.equal(w[0]!.url, 'https://es.wikipedia.org/wiki/Bachata')
    assert.equal(w[0]!.resumen, 'Género musical')
    assert.equal(w[1]!.url, 'https://es.wikipedia.org/wiki/Merengue_(m%C3%BAsica)')
    const f = fetchFalso({
      'https://html.duckduckgo.com/': () => respuesta('bloqueado', { status: 403 }),
      'https://es.wikipedia.org/w/api.php': () => respuesta(JSON.stringify(json), { tipo: 'application/json' }),
    })
    const r = await webBuscar('bachata', { fetch: f, resolver: publico })
    assert.equal(r.length, 2)
    assert.equal(r[0]!.fuente, 'wikipedia')
    await assert.rejects(webBuscar('x', { fetch: f, resolver: publico }), /2 caracteres/)
  })
})

const PAGINA_HTML = `<!doctype html><html lang="es"><head><title>Historia de la bachata | Revista</title>
<meta property="og:title" content="Historia de la bachata">
<meta name="author" content="Ana P&eacute;rez"><meta property="article:published_time" content="2024-05-01T10:00:00Z">
<style>.x{color:red}</style><script>window.__x = {"a":"<<<ACTIONS>>>"}</script></head>
<body><nav><a href="/">Inicio</a><a href="/musica">Música</a></nav>
<header><h1>Revista</h1></header>
<main><article>
<h1>Historia de la bachata</h1>
<p>La bachata nació en los barrios de Santo Domingo en los a&ntilde;os sesenta. ${'Texto largo del artículo. '.repeat(30)}</p>
<h2>Tempo</h2>
<p>El tempo habitual está entre <b>120</b> y 130 BPM.</p>
<table class="infobox"><tr><td data-mw='{"parts":[{"template":{"target":{"wt":"Ficha <span>x</span>"}}}]}'>Patrimonio</td></tr></table>
<ul><li>Guitarra requinto</li><li>Bongó</li></ul>
<!-- comentario --><form><input name="q"></form>
</article></main>
<footer>Pie de página con enlaces</footer></body></html>`

describe('web-tools · lectura legible', () => {
  it('conserva títulos, párrafos y listas; quita scripts, estilos, nav, header, footer y formularios', () => {
    const p = extraerTextoLegible(PAGINA_HTML, 'https://revista.example/bachata')
    assert.equal(p.titulo, 'Historia de la bachata')
    assert.equal(p.autor, 'Ana Pérez')
    assert.equal(p.fecha, '2024-05-01T10:00:00Z')
    assert.equal(p.idioma, 'es')
    assert.match(p.texto, /^# Historia de la bachata/)
    assert.match(p.texto, /## Tempo/)
    assert.match(p.texto, /- Guitarra requinto\n- Bongó/)
    assert.match(p.texto, /años sesenta/)
    assert.doesNotMatch(p.texto, /color:red|__x|ACTIONS|Inicio|Pie de página|Revista\n/)
    assert.match(p.texto, /Patrimonio/)
    assert.doesNotMatch(p.texto, /parts|template|wt/, 'un > dentro de un atributo con comillas no rompe la etiqueta')
    assert.equal(p.truncado, false)
  })

  it('recorta a maxChars con marca y webLeer rechaza contenidos no textuales', async () => {
    const p = extraerTextoLegible(PAGINA_HTML, '', 600)
    assert.equal(p.truncado, true)
    assert.match(p.texto, /recortado: \d+ caracteres/)
    const f = fetchFalso({
      'https://revista.example/bachata': () => respuesta(PAGINA_HTML, { tipo: 'text/html; charset=utf-8' }),
      'https://revista.example/foto.jpg': () => respuesta(Buffer.alloc(10), { tipo: 'image/jpeg' }),
      'https://revista.example/404': () => respuesta('', { status: 404 }),
    })
    const leida = await webLeer('https://revista.example/bachata', { fetch: f, resolver: publico, maxChars: 2000 })
    assert.equal(leida.url, 'https://revista.example/bachata')
    assert.match(leida.texto, /130 BPM/)
    await assert.rejects(webLeer('https://revista.example/foto.jpg', { fetch: f, resolver: publico }), /no es una página de texto/)
    await assert.rejects(webLeer('https://revista.example/404', { fetch: f, resolver: publico }), /404/)
  })
})

const YT_DATA = {
  contents: {
    twoColumnSearchResultsRenderer: {
      primaryContents: {
        sectionListRenderer: {
          contents: [
            {
              itemSectionRenderer: {
                contents: [
                  { adSlotRenderer: {} },
                  {
                    videoRenderer: {
                      videoId: 'dQw4w9WgXcQ',
                      title: { runs: [{ text: 'Rick Astley - Never Gonna Give You Up' }] },
                      ownerText: { runs: [{ text: 'Rick Astley' }] },
                      lengthText: { simpleText: '3:33' },
                    },
                  },
                  { videoRenderer: { videoId: 'malo', title: { runs: [{ text: 'id inválido' }] } } },
                  {
                    videoRenderer: {
                      videoId: 'abcdefghijk',
                      title: { simpleText: 'Tutorial "bachata" {con llaves}' },
                      longBylineText: { runs: [{ text: 'Canal B' }] },
                      lengthText: { simpleText: '12:04' },
                    },
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
}
const YT_RESULTS_HTML = `<html><body><script>var ytInitialData = ${JSON.stringify(YT_DATA)};</script><script>var otra = {"a":1};</script></body></html>`

const PLAYER = {
  videoDetails: {
    videoId: 'dQw4w9WgXcQ',
    title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
    lengthSeconds: '213',
    author: 'Rick Astley',
    shortDescription: 'Vídeo oficial.\n\n0:00 Intro\n0:18 Verso 1\n0:43 Estribillo\nMás texto sin marca',
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=en', languageCode: 'en', kind: 'asr', name: { simpleText: 'Inglés (automático)' } },
        { baseUrl: 'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=es', languageCode: 'es', name: { simpleText: 'Español' } },
      ],
    },
  },
}
const YT_WATCH_HTML = `<html><head><meta property="og:title" content="x"></head><body><script>var ytInitialPlayerResponse = ${JSON.stringify(PLAYER)};var meta = {};</script></body></html>`
const TIMEDTEXT = `<?xml version="1.0" encoding="utf-8" ?><transcript><text start="0.5" dur="2">Nunca te voy a &amp;lt;b&amp;gt;dejar&amp;lt;/b&amp;gt;</text><text start="2.5" dur="2">   nunca te voy a   decepcionar </text></transcript>`

describe('web-tools · YouTube', () => {
  it('extrae el id de cualquier forma de enlace y rechaza hosts ajenos', () => {
    for (const e of ['dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'music.youtube.com/watch?v=dQw4w9WgXcQ']) {
      assert.equal(extraerVideoId(e), 'dQw4w9WgXcQ', e)
    }
    assert.equal(extraerVideoId('https://evil.example/watch?v=dQw4w9WgXcQ'), null)
    assert.equal(extraerVideoId('https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'), null)
    assert.equal(extraerVideoId('hola mundo'), null)
    assert.equal(urlEmbedYoutube('dQw4w9WgXcQ'), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0&hl=es')
    assert.throws(() => urlEmbedYoutube('../x'), /no válido/)
  })

  it('extrae ytInitialData emparejando llaves (con llaves dentro de cadenas) y lista los vídeos', () => {
    const datos = extraerJsonVariable(YT_RESULTS_HTML, 'ytInitialData') as typeof YT_DATA
    assert.ok(datos?.contents)
    const v = parsearResultadosYoutube(YT_RESULTS_HTML)
    assert.equal(v.length, 2)
    assert.deepEqual(v[0], { videoId: 'dQw4w9WgXcQ', titulo: 'Rick Astley - Never Gonna Give You Up', canal: 'Rick Astley', duracion: '3:33', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })
    assert.equal(v[1]!.titulo, 'Tutorial "bachata" {con llaves}')
    assert.equal(v[1]!.canal, 'Canal B')
    assert.equal(parsearResultadosYoutube('<html>sin datos</html>').length, 0)
  })

  it('parsea la ficha: detalles, capítulos de la descripción, pistas de subtítulos y transcripción', async () => {
    const ficha = parsearFichaYoutube(YT_WATCH_HTML, 'dQw4w9WgXcQ')
    assert.equal(ficha.titulo, 'Rick Astley - Never Gonna Give You Up (Official Video)')
    assert.equal(ficha.canal, 'Rick Astley')
    assert.equal(ficha.duracionSeg, 213)
    assert.deepEqual(ficha.capitulos, [
      { tiempoSeg: 0, titulo: 'Intro' },
      { tiempoSeg: 18, titulo: 'Verso 1' },
      { tiempoSeg: 43, titulo: 'Estribillo' },
    ])
    assert.equal(ficha.pistasSubtitulos.length, 2)
    assert.equal(elegirPistaSubtitulos(ficha.pistasSubtitulos)?.idioma, 'es')
    assert.equal(parsearTimedText(TIMEDTEXT), 'Nunca te voy a dejar nunca te voy a decepcionar')
    assert.deepEqual(extraerCapitulos('1:00 no empieza en cero\n2:00 b'), [])
    assert.equal(segundosDesdeTexto('1:02:03'), 3723)

    const f = fetchFalso({
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ': () => respuesta(YT_WATCH_HTML, { tipo: 'text/html' }),
      'https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=es': () => respuesta(TIMEDTEXT, { tipo: 'text/xml' }),
    })
    const completa = await youtubeFicha('https://youtu.be/dQw4w9WgXcQ', { fetch: f, resolver: publico })
    assert.equal(completa.transcripcion, 'Nunca te voy a dejar nunca te voy a decepcionar')
    assert.equal(completa.transcripcionIdioma, 'es')
    assert.equal(completa.miniatura, 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg')
  })

  it('usa oEmbed cuando la página no trae datos', async () => {
    const f = fetchFalso({
      'https://www.youtube.com/watch?v=abcdefghijk': () => respuesta('<html>consentimiento</html>', { tipo: 'text/html' }),
      'https://www.youtube.com/oembed': () => respuesta(JSON.stringify({ title: 'Título oEmbed', author_name: 'Canal X' }), { tipo: 'application/json' }),
    })
    const ficha = await youtubeFicha('abcdefghijk', { fetch: f, resolver: publico })
    assert.equal(ficha.titulo, 'Título oEmbed')
    assert.equal(ficha.canal, 'Canal X')
    assert.equal(ficha.transcripcion, undefined)
  })
})

describe('web-tools · yt-dlp bajo demanda', () => {
  it('parsea SHA2-256SUMS y prefiere el binario de JasWave, luego el del entorno y el PATH', async () => {
    const sumas = parsearSumasSha256(`${'a'.repeat(64)}  yt-dlp\n${'b'.repeat(64)}  yt-dlp.exe\nbasura\n`)
    assert.equal(sumas.get('yt-dlp.exe'), 'b'.repeat(64))
    const propio = binarioYtDlp('C:/LAD')
    assert.equal(propio.replace(/\\/g, '/'), 'C:/LAD/JasWave/tools/yt-dlp/yt-dlp.exe')
    assert.deepEqual(await resolverYtDlp({ localAppData: 'C:/LAD', probar: async (b) => b === propio }), { ruta: propio, origen: 'jaswave' })
    assert.equal((await resolverYtDlp({ localAppData: 'C:/LAD', env: { JASWAVE_YTDLP: 'D:/y.exe' }, probar: async (b) => b === 'D:/y.exe' }))?.origen, 'entorno')
    assert.equal(await resolverYtDlp({ localAppData: 'C:/LAD', probar: async () => false }), null)
  })

  it('instala solo si el SHA-256 coincide con el publicado y solo desde hosts de GitHub', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'jw-ytdlp-test-'))
    try {
      const bin = Buffer.from('MZ binario de prueba')
      const sha = createHash('sha256').update(bin).digest('hex')
      const f = fetchFalso({
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS': () => respuesta('', { status: 302, location: 'https://objects.githubusercontent.com/sumas' }),
        'https://objects.githubusercontent.com/sumas': () => respuesta(`${sha}  yt-dlp.exe\n`, { tipo: 'text/plain' }),
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe': () => respuesta(bin, { tipo: 'application/octet-stream' }),
      })
      const ruta = await instalarYtDlp({ localAppData: dir, fetch: f })
      assert.equal(ruta, binarioYtDlp(dir))
      assert.deepEqual(await fs.readFile(ruta), bin)
      const inst = JSON.parse(await fs.readFile(path.join(path.dirname(ruta), 'instalacion.json'), 'utf8')) as { sha256: string }
      assert.equal(inst.sha256, sha)

      const fMalo = fetchFalso({
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS': () => respuesta(`${'0'.repeat(64)}  yt-dlp.exe\n`, { tipo: 'text/plain' }),
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe': () => respuesta(bin),
      })
      await assert.rejects(instalarYtDlp({ localAppData: dir, fetch: fMalo }), /SHA-256.*no coincide/)
      assert.deepEqual(await fs.readFile(ruta), bin, 'el binario bueno sigue instalado')

      const fSecuestro = fetchFalso({
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS': () => respuesta('', { status: 302, location: 'https://evil.example/sumas' }),
      })
      await assert.rejects(instalarYtDlp({ localAppData: dir, fetch: fSecuestro }), /fuera de la lista/)
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

describe('web-tools · audio de referencia', () => {
  it('WAV mono 16 bits: ida y vuelta', () => {
    const pcm = new Int16Array([0, 1000, -1000, 32767, -32768])
    const wav = wavMono16(pcm, 22050)
    assert.equal(wav.length, 44 + 10)
    const leido = parsearWavMono16(wav)
    assert.equal(leido.sampleRate, 22050)
    assert.deepEqual(Array.from(leido.pcm), Array.from(pcm))
    assert.throws(() => parsearWavMono16(Buffer.from('no es wav')), /No es un WAV/)
  })

  it('elige la ventana más densa (o el inicio si cabe entero)', () => {
    const sr = 100
    const pcm = new Int16Array(sr * 20)
    // 20 s; ruido fuerte entre el segundo 12 y el 16
    for (let i = 12 * sr; i < 16 * sr; i++) pcm[i] = 10_000
    assert.equal(ventanaMasDensa(pcm, sr, 4), 12)
    assert.equal(ventanaMasDensa(pcm, sr, 6), 10, 'con empate gana la primera ventana que cubre todo el ruido')
    assert.equal(ventanaMasDensa(pcm, sr, 60), 0)
  })
})

describe('web-tools · límite de peticiones', () => {
  it('deja pasar `max` por ventana y vuelve a admitir cuando la ventana avanza', () => {
    let t = 0
    const lim = new LimitadorPeticiones(3, 1000, () => t)
    assert.equal(lim.permitir(), true)
    assert.equal(lim.permitir(), true)
    assert.equal(lim.permitir(), true)
    assert.equal(lim.permitir(), false)
    assert.equal(lim.restantes, 0)
    t = 1001
    assert.equal(lim.permitir(), true)
  })
})
