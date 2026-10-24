import { useState, useTransition } from 'react'
import {
  Sparkles,
  ShieldCheck,
  Music4,
  Sliders,
  Cpu,
  Layers,
  Waves,
  LogIn,
  LogOut,
  UserCheck,
  Zap,
  ArrowRight,
  Check,
  Lock,
  ExternalLink,
  ShieldAlert,
  Settings,
  X,
} from 'lucide-react'
import { JasWaveAppIcon } from '@/components/brand'
import { useSesion, cerrarSesion, iniciarSesion, clienteSupabase } from '@/src/lib/backend/sesion'
import { configBackend } from '@/src/lib/backend/config'
import { PanelAdmin } from '@/components/admin/panel-admin'

interface PortalCatalogoPWAProps {
  onEntrarAlDaw: () => void
}

export function PortalCatalogoPWA({ onEntrarAlDaw }: PortalCatalogoPWAProps) {
  const sesion = useSesion()
  const { session, identidad, cargando, sinConfigurar } = sesion
  const [modalAuthAbierto, setModalAuthAbierto] = useState(false)
  const [modalAdminAbierto, setModalAdminAbierto] = useState(false)
  const [modoAuth, setModoAuth] = useState<'login' | 'registro'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authEnviando, setAuthEnviando] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<'todos' | 'efectos' | 'instrumentos'>('todos')
  const [, startTransition] = useTransition()

  // Determinar nivel de licencia aparente del usuario (Free, Pro, Ultra o Admin)
  const esAdmin = Boolean(identidad?.esAdmin)
  const roles = identidad?.roles ?? []
  const tieneLicencia = Boolean(session) // En JasWave todo usuario registrado tiene acceso base gratuito

  let nivelLicencia = 'Gratuita'
  if (esAdmin) nivelLicencia = 'Admin Maestro'
  else if (roles.includes('ultra')) nivelLicencia = 'Ultra'
  else if (roles.includes('pro')) nivelLicencia = 'Pro'

  const manejarAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthEnviando(true)
    setAuthError(null)
    try {
      if (modoAuth === 'login') {
        await iniciarSesion(email, password)
      } else {
        const sb = clienteSupabase()
        const { error } = await sb.auth.signUp({ email: email.trim(), password })
        if (error) throw error
      }
      setModalAuthAbierto(false)
      setEmail('')
      setPassword('')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setAuthError(msg === 'Invalid login credentials' ? 'Credenciales incorrectas' : msg)
    } finally {
      setAuthEnviando(false)
    }
  }

  const manejarClickEntrar = () => {
    if (!session && !sinConfigurar) {
      setModalAuthAbierto(true)
      return
    }
    startTransition(() => {
      onEntrarAlDaw()
    })
  }

  const pluginsCatalogo = [
    {
      id: 'com.jaswave.plugin.param-eq',
      nombre: 'JasWave Param-EQ',
      categoria: 'efectos',
      tipo: 'Ecualizador Quirúrgico 8 Bandas',
      desc: 'Ecualizador de fase lineal con doble analizador FFT en tiempo real, 6 tipos de filtro por banda y visualizador CRT.',
      icono: Sliders,
      badges: ['8 Bandas', 'FFT Pre/Post', 'Linear Phase'],
      incluidoEn: 'Gratuito',
    },
    {
      id: 'com.jaswave.plugin.bus-compressor',
      nombre: 'JasWave Bus Compressor',
      categoria: 'efectos',
      tipo: 'Compresor VCA de Bus',
      desc: 'Pegamento analógico clásico con enlace estéreo, filtro paso-altos para sidechain, compresión paralela Dry/Wet y detector RMS/Peak.',
      icono: Waves,
      badges: ['VCA Glue', 'Sidechain HPF', 'Paralelo'],
      incluidoEn: 'Pro',
    },
    {
      id: 'com.jaswave.plugin.truepeak-limiter',
      nombre: 'JasWave True-Peak Limiter',
      categoria: 'efectos',
      tipo: 'Limitador de Masterización',
      desc: 'Limitador estricto para plataformas de streaming con sobremuestreo 8×/16× normativo BS.1770-4 y medición LUFS integrada.',
      icono: ShieldCheck,
      badges: ['16× Oversampling', 'LUFS EBU R128', 'Dither'],
      incluidoEn: 'Pro',
    },
    {
      id: 'com.jaswave.plugin.smart-deesser',
      nombre: 'JasWave Smart De-Esser',
      categoria: 'efectos',
      tipo: 'De-Esser Espectral Inteligente',
      desc: 'Atenuación transparente de sibilancias con detección espectral dinámica, escucha de sidechain y modo Split/Wide.',
      icono: Sparkles,
      badges: ['Split-Band', 'Listen SC', 'Dinámico'],
      incluidoEn: 'Pro',
    },
    {
      id: 'com.jaswave.plugin.utility-tool',
      nombre: 'JasWave Utility Tool',
      categoria: 'efectos',
      tipo: 'Herramienta Integral de Canal',
      desc: 'Procesador de imagen estéreo M/S, inversión de fase L/R, filtro mono de graves y goniómetro Lissajous en rombo.',
      icono: Cpu,
      badges: ['M/S Width', 'Goniómetro', 'Mono-Bass'],
      incluidoEn: 'Gratuito',
    },
    {
      id: 'com.jaswave.plugin.piano-synth',
      nombre: 'JasWave Piano Synth',
      categoria: 'instrumentos',
      tipo: 'Piano Acústico Modal Sintético',
      desc: 'Modelado físico de cuerdas y caja armónica, respuesta dinámica al tacto, afinación de precisión y teclado interactivo.',
      icono: Music4,
      badges: ['Modelado Físico', '88 Teclas', '32 Voces'],
      incluidoEn: 'Gratuito',
    },
    {
      id: 'com.jaswave.plugin.roles-vst',
      nombre: 'JasWave Roles Synth',
      categoria: 'instrumentos',
      tipo: 'Sintetizador Multitímbrico de Producción',
      desc: 'Generador polifónico orquestal con 13 roles pre-calibrados: Bajo, Batería, Leads, Pads, Cuerdas y Metales cibernéticos.',
      icono: Layers,
      badges: ['13 Roles', 'Filtro Ladder', 'Multi-FX'],
      incluidoEn: 'Ultra',
    },
  ]

  const pluginsFiltrados = pluginsCatalogo.filter((p) => {
    if (filtroCategoria === 'todos') return true
    return p.categoria === filtroCategoria
  })

  return (
    <div className="relative min-h-screen bg-[#050D14] text-slate-100 font-sans selection:bg-[#2FD6F2]/30 selection:text-white">
      {/* Fondo con viñeta cibernética y retícula Direct2D */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#0A1822]/80 via-[#050D14] to-[#03080D]" />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `linear-gradient(#2FD6F2 1px, transparent 1px), linear-gradient(90deg, #2FD6F2 1px, transparent 1px)`,
          backgroundSize: '44px 44px',
        }}
      />

      {/* Barra de Navegación Superior */}
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-[#1E4656]/60 bg-[#0B1823]/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-[#2FD6F2]/40 bg-[#050D14] shadow-[0_0_15px_rgba(47,214,242,0.25)]">
            <JasWaveAppIcon className="size-5 text-[#2FD6F2]" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-widest text-[#7FE3F5] uppercase">JASWAVE</span>
            <span className="ml-2 rounded border border-[#2FD6F2]/30 bg-[#2FD6F2]/10 px-1.5 py-0.5 text-[9px] font-mono tracking-wider text-[#2FD6F2]">
              STUDIO PWA
            </span>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-xs text-[#8FB4BF]">
          <a href="#catalogo" className="transition-colors hover:text-[#2FD6F2]">
            Catálogo VSTs
          </a>
          <a href="#planes" className="transition-colors hover:text-[#2FD6F2]">
            Planes & Licencias
          </a>
          <a href="#compatibilidad" className="transition-colors hover:text-[#2FD6F2]">
            Reaper & DAW Host
          </a>
        </nav>

        <div className="flex items-center gap-3">
          {cargando ? (
            <span className="text-xs text-[#4F6B75]">Verificando sesión…</span>
          ) : session ? (
            <div className="flex items-center gap-2">
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => setModalAdminAbierto(true)}
                  className="flex items-center gap-1 rounded border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)] hover:bg-amber-500/20"
                >
                  <Settings className="size-3" />
                  Admin
                </button>
              )}
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-medium text-[#A8EEFA] truncate max-w-[140px]">{session.user.email}</span>
                <span className="text-[10px] text-[#2FD6F2] font-mono">{nivelLicencia}</span>
              </div>
              <button
                type="button"
                onClick={() => void cerrarSesion()}
                title="Cerrar sesión"
                className="rounded-md border border-[#1E4656] bg-[#050D14] p-1.5 text-[#8FB4BF] hover:border-red-500/50 hover:text-red-400"
              >
                <LogOut className="size-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setModoAuth('login')
                setModalAuthAbierto(true)
              }}
              className="flex items-center gap-1.5 rounded border border-[#2FD6F2]/50 bg-[#2FD6F2]/10 px-3 py-1.5 text-xs font-medium text-[#2FD6F2] transition-all hover:bg-[#2FD6F2]/20 hover:shadow-[0_0_12px_rgba(47,214,242,0.3)]"
            >
              <LogIn className="size-3.5" />
              Iniciar Sesión
            </button>
          )}

          <button
            type="button"
            onClick={manejarClickEntrar}
            className="flex items-center gap-1.5 rounded bg-gradient-to-r from-[#2FD6F2] to-[#1AB0CE] px-4 py-1.5 text-xs font-semibold text-[#050D14] shadow-[0_0_15px_rgba(47,214,242,0.4)] transition-all hover:brightness-110 active:scale-95"
          >
            Ir al DAW
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-12 text-center md:pt-24">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#2FD6F2]/30 bg-[#0B1823]/90 px-3 py-1 text-xs text-[#7FE3F5] mb-6 backdrop-blur-sm">
          <Zap className="size-3.5 text-[#2FD6F2]" />
          <span>Arquitectura Híbrida: Direct2D C++ Nativo + WebAudio PWA</span>
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl sm:leading-none">
          CREA MÚSICA SIN LÍMITES EN{' '}
          <span className="bg-gradient-to-r from-[#2FD6F2] via-[#7FE3F5] to-[#BFF6FF] bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(47,214,242,0.4)]">
            JASWAVE STUDIO
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-[#8FB4BF] sm:text-base">
          El primer DAW modular futurista con suite de plugins VST3 unificada. Diseñado para ejecutarse en tu navegador
          con latencia cero o como plugins nativos dentro de Reaper, Ableton Live y FL Studio.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={manejarClickEntrar}
            className="flex items-center gap-2 rounded-lg bg-[#2FD6F2] px-6 py-3 text-sm font-bold text-[#050D14] shadow-[0_0_25px_rgba(47,214,242,0.5)] transition-all hover:bg-[#7FE3F5] hover:scale-105 active:scale-95"
          >
            <Music4 className="size-4" />
            Entrar al Estudio (DAW)
          </button>

          <a
            href="#catalogo"
            className="flex items-center gap-2 rounded-lg border border-[#1E4656] bg-[#0B1823]/80 px-6 py-3 text-sm font-medium text-[#A8EEFA] transition-all hover:border-[#2FD6F2]/50 hover:bg-[#0B1823]"
          >
            Explorar Catálogo VST3
          </a>
        </div>

        {/* Estado de acceso */}
        <div className="mt-6 text-xs text-[#4F6B75]">
          {session ? (
            <span className="text-emerald-400">● Conectado como {session.user.email} (Acceso Autorizado)</span>
          ) : (
            <span>● Requiere cuenta JasWave para sincronización y desbloqueo de audio.</span>
          )}
        </div>
      </section>

      {/* Sección Catálogo de Plugins */}
      <section id="catalogo" className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#1E4656] pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-wider text-[#7FE3F5] uppercase">Catálogo de Plugins VST3</h2>
            <p className="text-xs text-[#8FB4BF]">Plugins nativos y módulos web listos para producción profesional.</p>
          </div>

          <div className="flex gap-2">
            {(['todos', 'efectos', 'instrumentos'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFiltroCategoria(cat)}
                className={`rounded px-3 py-1 text-xs font-medium uppercase transition-colors ${
                  filtroCategoria === cat
                    ? 'border border-[#2FD6F2]/60 bg-[#2FD6F2]/20 text-[#2FD6F2]'
                    : 'border border-transparent text-[#8FB4BF] hover:text-[#A8EEFA]'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {pluginsFiltrados.map((plugin) => {
            const Icono = plugin.icono
            return (
              <div
                key={plugin.id}
                className="group relative flex flex-col justify-between rounded-xl border border-[#1E4656] bg-[#0B1823]/90 p-5 shadow-lg transition-all hover:border-[#2FD6F2]/60 hover:shadow-[0_0_20px_rgba(47,214,242,0.15)]"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-[#2FD6F2]/30 bg-[#050D14] text-[#2FD6F2] group-hover:shadow-[0_0_12px_rgba(47,214,242,0.3)]">
                      <Icono className="size-5" />
                    </div>
                    <span className="rounded border border-[#1E4656] bg-[#050D14] px-2 py-0.5 text-[10px] font-mono text-[#7FE3F5]">
                      {plugin.incluidoEn}
                    </span>
                  </div>

                  <h3 className="mt-4 text-base font-bold text-white group-hover:text-[#7FE3F5] transition-colors">
                    {plugin.nombre}
                  </h3>
                  <p className="text-[11px] font-mono text-[#2FD6F2]">{plugin.tipo}</p>
                  <p className="mt-2 text-xs leading-relaxed text-[#8FB4BF]">{plugin.desc}</p>
                </div>

                <div className="mt-4 pt-4 border-t border-[#1E4656]/50">
                  <div className="flex flex-wrap gap-1.5">
                    {plugin.badges.map((b) => (
                      <span key={b} className="rounded bg-[#050D14] px-2 py-0.5 text-[9px] text-[#A8EEFA]">
                        {b}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* Sección Planes de Membresía */}
      <section id="planes" className="relative z-10 mx-auto max-w-5xl px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-bold tracking-wider text-[#7FE3F5] uppercase">Planes y Licencias JasWave</h2>
          <p className="mt-2 text-xs text-[#8FB4BF]">
            Elige el nivel de potencia adecuado para tu estudio. Todos los planes incluyen acceso completo al DAW Web.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Plan Gratuito */}
          <div className="flex flex-col justify-between rounded-xl border border-[#1E4656] bg-[#0B1823]/80 p-6 backdrop-blur-sm">
            <div>
              <span className="text-xs font-mono text-[#8FB4BF] uppercase">Comunidad</span>
              <h3 className="text-xl font-bold text-white mt-1">Gratuita</h3>
              <div className="mt-3 text-2xl font-extrabold text-[#7FE3F5]">$0</div>
              <p className="mt-2 text-xs text-[#8FB4BF]">Para productores que inician en el ecosistema JasWave.</p>

              <ul className="mt-6 space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> Acceso completo al DAW Web y Desktop
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> EQ Paramétrico (4 bandas)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> Compresor de canal básico
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> Piano Synth acústico (16 voces)
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={manejarClickEntrar}
              className="mt-8 w-full rounded border border-[#2FD6F2]/50 bg-[#2FD6F2]/10 py-2.5 text-xs font-semibold text-[#2FD6F2] hover:bg-[#2FD6F2]/20"
            >
              Comenzar Gratis
            </button>
          </div>

          {/* Plan Pro */}
          <div className="relative flex flex-col justify-between rounded-xl border-2 border-[#2FD6F2] bg-[#0B1823] p-6 shadow-[0_0_30px_rgba(47,214,242,0.2)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[#2FD6F2] bg-[#050D14] px-3 py-0.5 text-[10px] font-bold text-[#2FD6F2] uppercase">
              Más Popular
            </div>
            <div>
              <span className="text-xs font-mono text-[#2FD6F2] uppercase">Estudio</span>
              <h3 className="text-xl font-bold text-white mt-1">Pro Creator</h3>
              <div className="mt-3 text-2xl font-extrabold text-[#7FE3F5]">
                $9.99 <span className="text-xs font-normal text-[#8FB4BF]">/ mes</span>
              </div>
              <p className="mt-2 text-xs text-[#8FB4BF]">Para mezcla profesional, masterización y streaming.</p>

              <ul className="mt-6 space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> Todo lo incluido en Gratuita
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> EQ 8 bandas quirúrgico completo
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> Bus Compressor VCA + Sidechain HPF
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> TruePeak Limiter 8× + LUFS
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#2FD6F2]" /> Guardado y sincronización en la nube
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={manejarClickEntrar}
              className="mt-8 w-full rounded bg-[#2FD6F2] py-2.5 text-xs font-bold text-[#050D14] shadow-[0_0_15px_rgba(47,214,242,0.4)] hover:bg-[#7FE3F5]"
            >
              Obtener Pro
            </button>
          </div>

          {/* Plan Ultra */}
          <div className="flex flex-col justify-between rounded-xl border border-[#1E4656] bg-[#0B1823]/80 p-6 backdrop-blur-sm">
            <div>
              <span className="text-xs font-mono text-purple-400 uppercase">Suite Completa</span>
              <h3 className="text-xl font-bold text-white mt-1">Ultra Suite</h3>
              <div className="mt-3 text-2xl font-extrabold text-[#7FE3F5]">
                $19.99 <span className="text-xs font-normal text-[#8FB4BF]">/ mes</span>
              </div>
              <p className="mt-2 text-xs text-[#8FB4BF]">Acceso sin restricciones para DAWs externos y masterización.</p>

              <ul className="mt-6 space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-purple-400" /> Licencia VST3 Nativa para Reaper, Ableton, FL Studio
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-purple-400" /> TruePeak Limiter a 16× sobremuestreo
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-purple-400" /> Roles Synth con 13 roles desbloqueados
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-purple-400" /> Smart De-Esser dinámico split-band
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-purple-400" /> Asistente IA de audio sin límites
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={manejarClickEntrar}
              className="mt-8 w-full rounded border border-purple-500/50 bg-purple-500/10 py-2.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/20"
            >
              Obtener Ultra
            </button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-[#1E4656]/50 bg-[#03080D] px-6 py-8 text-center text-xs text-[#4F6B75]">
        <p>© 2026 JasWave Audio Workstation. Desarrollado con Direct2D C++, WebAudio y Supabase.</p>
        <p className="mt-1 text-[10px]">Todos los plugins VST3 son marcas registradas de JasWave Audio Technologies.</p>
      </footer>

      {/* Modal de Autenticación (Login / Registro) */}
      {modalAuthAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-xl border border-[#2FD6F2]/40 bg-[#0B1823] p-6 shadow-[0_0_40px_rgba(47,214,242,0.2)]">
            <button
              type="button"
              onClick={() => setModalAuthAbierto(false)}
              className="absolute top-4 right-4 text-[#8FB4BF] hover:text-white"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <JasWaveAppIcon className="size-5 text-[#2FD6F2]" />
              <h3 className="text-base font-bold text-white uppercase tracking-wider">
                {modoAuth === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
              </h3>
            </div>

            <p className="text-xs text-[#8FB4BF] mb-4">
              {modoAuth === 'login'
                ? 'Ingresa tus credenciales para acceder a tu estudio y activar tus plugins VST3.'
                : 'Crea tu cuenta gratuita de JasWave para acceder al DAW y obtener tu licencia base.'}
            </p>

            <form onSubmit={manejarAuth} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-[#A8EEFA] mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@ejemplo.com"
                  className="w-full rounded border border-[#1E4656] bg-[#050D14] px-3 py-2 text-xs text-white placeholder-[#4F6B75] focus:border-[#2FD6F2] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#A8EEFA] mb-1">Contraseña</label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded border border-[#1E4656] bg-[#050D14] px-3 py-2 text-xs text-white placeholder-[#4F6B75] focus:border-[#2FD6F2] focus:outline-none"
                />
              </div>

              {authError && (
                <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authEnviando}
                className="w-full rounded bg-[#2FD6F2] py-2 text-xs font-bold text-[#050D14] shadow-[0_0_15px_rgba(47,214,242,0.3)] hover:bg-[#7FE3F5] transition-all disabled:opacity-50"
              >
                {authEnviando ? 'Verificando…' : modoAuth === 'login' ? 'Entrar' : 'Registrarse'}
              </button>
            </form>

            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => {
                  setModoAuth(modoAuth === 'login' ? 'registro' : 'login')
                  setAuthError(null)
                }}
                className="text-xs text-[#2FD6F2] hover:underline"
              >
                {modoAuth === 'login' ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Admin */}
      {modalAdminAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-xl border border-amber-500/50 bg-[#0B1823] p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setModalAdminAbierto(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              <X className="size-5" />
            </button>
            <div className="flex items-center gap-2 mb-4">
              <Settings className="size-5 text-amber-400" />
              <h3 className="text-lg font-bold text-white uppercase tracking-wider">
                Panel Maestro de Administración
              </h3>
            </div>
            <PanelAdmin />
          </div>
        </div>
      )}
    </div>
  )
}
