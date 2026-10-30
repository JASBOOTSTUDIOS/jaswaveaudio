/**
 * G7: dictado por voz con el reconocedor local de Windows (System.Speech).
 *
 * En Electron la Web Speech API de Chromium no funciona (sin claves de Google → error `network`), así que
 * main lanza un PowerShell hijo con `SpeechRecognitionEngine` + `DictationGrammar` que escribe en stdout una
 * línea JSON por evento. Aquí está la parte pura (script, codificación y parseo); el proceso vive en
 * `dictado-windows.ts`.
 */

export type EventoDictado =
  | { tipo: 'listo'; cultura?: string; motor?: string }
  | { tipo: 'parcial'; texto: string }
  | { tipo: 'final'; texto: string; confianza?: number }
  | { tipo: 'error'; codigo: string; mensaje: string }
  | { tipo: 'fin' }

/** Cultura BCP-47 aceptada (es-ES, es-MX, en-US…); cualquier otra cosa cae a es-ES. */
export function culturaValida(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  return /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(s) ? s : 'es-ES'
}

/**
 * Script de PowerShell del reconocedor. Elige el reconocedor instalado de la cultura pedida (o, si no hay,
 * uno del mismo idioma), dicta desde el micrófono por defecto y sale solo si muere el proceso padre.
 */
export function scriptReconocedorWindows(opciones: { cultura: string; pidPadre: number }): string {
  const cultura = culturaValida(opciones.cultura)
  const idioma = cultura.split('-')[0]
  const pid = Math.max(0, Math.floor(Number(opciones.pidPadre) || 0))
  return [
    "$ErrorActionPreference = 'Stop'",
    // Sin esto Add-Type escribe una barra de progreso (CLIXML) en stderr.
    "$ProgressPreference = 'SilentlyContinue'",
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    'function Emitir($o) { [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress)); [Console]::Out.Flush() }',
    'try {',
    '  Add-Type -AssemblyName System.Speech',
    '  $todos = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()',
    `  $info = $todos | Where-Object { $_.Culture.Name -eq '${cultura}' } | Select-Object -First 1`,
    `  if (-not $info) { $info = $todos | Where-Object { $_.Culture.TwoLetterISOLanguageName -eq '${idioma}' } | Select-Object -First 1 }`,
    `  if (-not $info) { Emitir @{ tipo = 'error'; codigo = 'sin-reconocedor'; mensaje = 'Windows no tiene instalado el reconocimiento de voz para ${cultura}' }; exit 2 }`,
    '  $motor = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)',
    '  $motor.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))',
    '  $motor.SetInputToDefaultAudioDevice()',
    "  Register-ObjectEvent -InputObject $motor -EventName SpeechHypothesized -SourceIdentifier jwParcial | Out-Null",
    "  Register-ObjectEvent -InputObject $motor -EventName SpeechRecognized -SourceIdentifier jwFinal | Out-Null",
    "  Register-ObjectEvent -InputObject $motor -EventName RecognizeCompleted -SourceIdentifier jwFin | Out-Null",
    '  $motor.RecognizeAsync([System.Speech.Recognition.RecognizeMode]::Multiple)',
    "  Emitir @{ tipo = 'listo'; cultura = $info.Culture.Name; motor = $info.Id }",
    `  $padre = ${pid}`,
    '  while ($true) {',
    '    $ev = Wait-Event -Timeout 1',
    '    if ($ev) {',
    '      $id = $ev.SourceIdentifier',
    '      $res = $ev.SourceEventArgs.Result',
    "      if ($id -eq 'jwParcial' -and $res) { Emitir @{ tipo = 'parcial'; texto = $res.Text } }",
    "      elseif ($id -eq 'jwFinal' -and $res) { Emitir @{ tipo = 'final'; texto = $res.Text; confianza = [math]::Round($res.Confidence, 3) } }",
    "      elseif ($id -eq 'jwFin') {",
    '        $err = $ev.SourceEventArgs.Error',
    "        if ($err) { Emitir @{ tipo = 'error'; codigo = 'motor'; mensaje = $err.Message } }",
    "        Emitir @{ tipo = 'fin' }; break",
    '      }',
    '      Remove-Event -EventIdentifier $ev.EventIdentifier',
    '    }',
    "    if ($padre -gt 0 -and -not (Get-Process -Id $padre -ErrorAction SilentlyContinue)) { break }",
    '  }',
    // Dispose() del motor tarda >10 s en soltar el micrófono: salir del proceso lo libera al instante.
    '  [Environment]::Exit(0)',
    '} catch {',
    "  $codigo = if ($_.Exception.Message -match 'audio|micr|device') { 'sin-microfono' } else { 'motor' }",
    "  Emitir @{ tipo = 'error'; codigo = $codigo; mensaje = $_.Exception.Message }",
    '  exit 1',
    '}',
  ].join('\n')
}

/** `-EncodedCommand` (UTF-16LE en base64): evita problemas de comillas y saltos de línea en la línea de órdenes. */
export function codificarComandoPowerShell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

/** Argumentos de `powershell.exe` para el script del reconocedor. */
export function argumentosPowerShell(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', codificarComandoPowerShell(script)]
}

/** Una línea de stdout → evento, o null si no es un evento válido (avisos de PowerShell, líneas vacías). */
export function parsearEventoDictado(linea: string): EventoDictado | null {
  // trim() también quita el BOM que PowerShell puede anteponer a la primera línea.
  const t = linea.trim()
  if (!t.startsWith('{')) return null
  let o: Record<string, unknown>
  try {
    const v = JSON.parse(t) as unknown
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null
    o = v as Record<string, unknown>
  } catch {
    return null
  }
  const texto = typeof o.texto === 'string' ? o.texto : ''
  switch (o.tipo) {
    case 'listo':
      return {
        tipo: 'listo',
        ...(typeof o.cultura === 'string' ? { cultura: o.cultura } : {}),
        ...(typeof o.motor === 'string' ? { motor: o.motor } : {}),
      }
    case 'parcial':
      return texto ? { tipo: 'parcial', texto } : null
    case 'final': {
      if (!texto) return null
      const confianza = Number(o.confianza)
      return Number.isFinite(confianza) ? { tipo: 'final', texto, confianza } : { tipo: 'final', texto }
    }
    case 'error':
      return {
        tipo: 'error',
        codigo: typeof o.codigo === 'string' && o.codigo ? o.codigo : 'motor',
        mensaje: typeof o.mensaje === 'string' && o.mensaje ? o.mensaje : 'Error del reconocedor de voz',
      }
    case 'fin':
      return { tipo: 'fin' }
    default:
      return null
  }
}

/** Trocea stdout en líneas completas (un evento puede llegar partido entre dos `data`). */
export function crearLectorEventos(alEvento: (e: EventoDictado) => void): { empujar: (trozo: string) => void; cerrar: () => void } {
  let resto = ''
  return {
    empujar(trozo: string) {
      resto += trozo
      const lineas = resto.split(/\r?\n/)
      resto = lineas.pop() ?? ''
      for (const l of lineas) {
        const ev = parsearEventoDictado(l)
        if (ev) alEvento(ev)
      }
    },
    cerrar() {
      const ev = parsearEventoDictado(resto)
      resto = ''
      if (ev) alEvento(ev)
    },
  }
}
