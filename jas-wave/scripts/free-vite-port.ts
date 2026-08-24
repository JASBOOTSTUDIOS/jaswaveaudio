/**
 * Libera el puerto de Vite si quedó un `node` huérfano de un `npm run dev` anterior.
 */
import { execSync } from 'child_process'

const PORT = Number(process.env.VITE_PORT || 5173)

function pidsOnPort(port: number): number[] {
  if (process.platform !== 'win32') {
    try {
      const out = execSync(`lsof -ti tcp:${port}`, { encoding: 'utf8' })
      return out
        .split(/\s+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
    } catch {
      return []
    }
  }
  try {
    const out = execSync(`netstat -ano`, { encoding: 'utf8' })
    const pids = new Set<number>()
    for (const line of out.split(/\r?\n/)) {
      if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue
      const parts = line.trim().split(/\s+/)
      const pid = Number(parts[parts.length - 1])
      if (pid > 0) pids.add(pid)
    }
    return [...pids]
  } catch {
    return []
  }
}

const pids = pidsOnPort(PORT)
for (const pid of pids) {
  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', windowsHide: true })
    } else {
      process.kill(pid, 'SIGTERM')
    }
    console.log(`[dev] liberado puerto ${PORT} (pid ${pid})`)
  } catch {
    /* ignore */
  }
}
