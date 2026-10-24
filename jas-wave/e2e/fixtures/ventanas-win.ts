/**
 * Ventanas nativas de Windows vistas desde fuera (Win32 vía PowerShell), para comprobar lo que
 * Playwright no ve: el editor del plugin-host superpuesto al panel del DAW, en píxeles físicos.
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export type Rect = { x: number; y: number; w: number; h: number }
export type VentanaNativa = {
  hwnd: string
  pid: number
  clase: string
  visible: boolean
  minimizada: boolean
  rect: Rect
  /** Origen del área cliente en pantalla. */
  cliente: Rect
  hijos: Array<{ clase: string; rect: Rect; visible: boolean }>
}

const CS = String.raw`
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class JwVentanas {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr h, EnumProc f, IntPtr p);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  static string Clase(IntPtr h) { var s = new StringBuilder(256); GetClassName(h, s, 256); return s.ToString(); }
  static string R(RECT r) { return "{\"x\":" + r.L + ",\"y\":" + r.T + ",\"w\":" + (r.R - r.L) + ",\"h\":" + (r.B - r.T) + "}"; }
  static string Esc(string s) { return s.Replace("\\", "\\\\").Replace("\"", "\\\""); }
  public static string Listar(string clases) {
    SetThreadDpiAwarenessContext(new IntPtr(-4)); // PER_MONITOR_AWARE_V2: píxeles físicos reales
    var quiero = new HashSet<string>(clases.Split(','));
    var sb = new StringBuilder("[");
    bool primero = true;
    EnumWindows((h, p) => {
      string c = Clase(h);
      if (!quiero.Contains(c)) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      RECT r; GetWindowRect(h, out r);
      RECT cr; GetClientRect(h, out cr);
      POINT o = new POINT(); ClientToScreen(h, ref o);
      var hijos = new StringBuilder("[");
      bool ph = true;
      EnumChildWindows(h, (hc, pc) => {
        RECT rc; GetWindowRect(hc, out rc);
        if (!ph) hijos.Append(",");
        ph = false;
        hijos.Append("{\"clase\":\"" + Esc(Clase(hc)) + "\",\"visible\":" + (IsWindowVisible(hc) ? "true" : "false") + ",\"rect\":" + R(rc) + "}");
        return true;
      }, IntPtr.Zero);
      hijos.Append("]");
      if (!primero) sb.Append(",");
      primero = false;
      sb.Append("{\"hwnd\":\"" + h.ToInt64() + "\",\"pid\":" + pid + ",\"clase\":\"" + Esc(c) + "\",\"visible\":" + (IsWindowVisible(h) ? "true" : "false") +
        ",\"minimizada\":" + (IsIconic(h) ? "true" : "false") + ",\"rect\":" + R(r) +
        ",\"cliente\":{\"x\":" + o.X + ",\"y\":" + o.Y + ",\"w\":" + (cr.R - cr.L) + ",\"h\":" + (cr.B - cr.T) + "},\"hijos\":" + hijos + "}");
      return true;
    }, IntPtr.Zero);
    return sb.Append("]").ToString();
  }
}`

function powershell(script: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jw-ventanas-'))
  const file = path.join(dir, 'v.ps1')
  fs.writeFileSync(file, script, 'utf8')
  try {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
    })
    if (r.status !== 0) throw new Error(`powershell: ${r.stderr || r.stdout}`)
    return r.stdout.trim()
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

const cabecera = (cs: string) => `$cs = @'\n${cs}\n'@\nAdd-Type -TypeDefinition $cs -Language CSharp\n`

/** Ventanas de nivel superior de las clases dadas (de cualquier proceso). */
export function ventanasNativas(clases: string[]): VentanaNativa[] {
  const out = powershell(`${cabecera(CS)}[Console]::OutputEncoding = [Text.Encoding]::UTF8\n[JwVentanas]::Listar('${clases.join(',')}')\n`)
  return JSON.parse(out) as VentanaNativa[]
}

/** ShowWindow sobre una ventana (6 = minimizar, 9 = restaurar). */
export function mostrarVentana(hwnd: string, comando: number): void {
  powershell(`${cabecera(CS)}[void][JwVentanas]::ShowWindow([IntPtr]${hwnd}, ${comando})\n`)
}

/**
 * Imagen de UNA ventana (PrintWindow con PW_RENDERFULLCONTENT), sin copiar la pantalla: no recoge
 * nada de otras aplicaciones aunque estén delante.
 */
export function capturarVentana(hwnd: string, archivo: string): void {
  const cs = String.raw`
using System;
using System.Drawing;
using System.Runtime.InteropServices;
public static class JwCaptura {
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr c);
  public static void Guardar(long hwnd, string archivo) {
    SetThreadDpiAwarenessContext(new IntPtr(-4));
    var h = new IntPtr(hwnd);
    RECT r; GetClientRect(h, out r);
    using (var b = new Bitmap(Math.Max(1, r.R - r.L), Math.Max(1, r.B - r.T)))
    using (var g = Graphics.FromImage(b)) {
      var hdc = g.GetHdc();
      PrintWindow(h, hdc, 3); // PW_CLIENTONLY | PW_RENDERFULLCONTENT
      g.ReleaseHdc(hdc);
      b.Save(archivo, System.Drawing.Imaging.ImageFormat.Png);
    }
  }
}`
  powershell(
    `$cs = @'\n${cs}\n'@\nAdd-Type -TypeDefinition $cs -Language CSharp -ReferencedAssemblies System.Drawing\n` +
      `[JwCaptura]::Guardar(${hwnd}, '${archivo.replace(/'/g, "''")}')\n`,
  )
}
