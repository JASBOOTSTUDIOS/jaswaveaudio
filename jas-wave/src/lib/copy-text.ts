/**
 * Copia texto al portapapeles con fallbacks (Electron a menudo rechaza navigator.clipboard).
 */

export async function copyTextToClipboard(text: string): Promise<boolean> {
  const value = text ?? ''
  if (!value) return false

  const electronApi = (
    window as unknown as {
      electron?: { clipboardWriteText?: (t: string) => Promise<boolean> }
    }
  ).electron
  if (typeof electronApi?.clipboardWriteText === 'function') {
    try {
      const ok = await electronApi.clipboardWriteText(value)
      if (ok !== false) return true
    } catch {
      /* fall through */
    }
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    /* fall through */
  }

  try {
    const ta = document.createElement('textarea')
    ta.value = value
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '0'
    ta.style.left = '0'
    ta.style.width = '1px'
    ta.style.height = '1px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    ta.setSelectionRange(0, value.length)
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
