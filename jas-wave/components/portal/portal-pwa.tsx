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
  Zap,
  ArrowRight,
  Check,
  Settings,
  X,
  Eye,
  EyeOff,
} from 'lucide-react'
import { JasWaveAppIcon, JasWaveLogo } from '@/components/brand'
import { WindowTitleBar } from '@/components/window-title-bar'
import { useSesion, cerrarSesion, iniciarSesion, clienteSupabase } from '@/src/lib/backend/sesion'
import { abrirAppAdmin } from '@/src/admin-app/abrir'

interface PortalCatalogoPWAProps {
  onEntrarAlDaw: () => void
}

export function PortalCatalogoPWA({ onEntrarAlDaw }: PortalCatalogoPWAProps) {
  const sesion = useSesion()
  const { session, identidad, cargando, sinConfigurar } = sesion
  const [modalAuthAbierto, setModalAuthAbierto] = useState(false)
  const [modoAuth, setModoAuth] = useState<'login' | 'registro'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mostrarPassword, setMostrarPassword] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [authEnviando, setAuthEnviando] = useState(false)
  const [filtroCategoria, setFiltroCategoria] = useState<'todos' | 'efectos' | 'instrumentos'>('todos')
  const [, startTransition] = useTransition()

  // Determinar nivel de licencia aparente del usuario (Free, Pro, Ultra o Admin)
  const esAdmin = Boolean(identidad?.esAdmin)
  const roles = identidad?.roles ?? []

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
      tipo: 'Ecualizador Dinámico hasta 24 Bandas',
      desc: 'Ecualizador de fase lineal con doble analizador FFT en tiempo real, 6 tipos de filtro por banda y visualizador CRT.',
      icono: Sliders,
      badges: ['24 Bandas', 'FFT Pre/Post', 'Fase mínima'],
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
      id: 'com.jaswave.plugin.pedal-fix',
      nombre: 'JasWave Pedal Fix',
      categoria: 'efectos',
      tipo: 'Efecto MIDI para el pedal de sustain',
      desc: 'Unifica el pedal de teclados que lo mandan por varios canales (PSR-E373), corrige la polaridad, fuerza el sustain, fija el canal y transpone; retiene las notas hasta soltar el pedal.',
      icono: Cpu,
      badges: ['Pedal unificado', 'Polaridad', 'Canal fijo'],
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
    <div className="relative min-h-screen bg-[#05060F] text-slate-100 font-sans selection:bg-[#19D9FF]/30 selection:text-white">
      {/* Escritorio: el Portal también es la ventana sin marco → minimizar / maximizar / cerrar siempre visibles */}
      <div className="sticky top-0 z-[60]">
        <WindowTitleBar soloEscritorio color="#05060F">
          <div className="flex min-w-0 items-center gap-2 px-3 text-[12px] font-semibold text-[#D6D9EE]">
            <JasWaveAppIcon className="size-[22px] shrink-0 text-[#19D9FF]" />
            <span className="truncate">JasWave · Portal</span>
          </div>
        </WindowTitleBar>
      </div>
      {/* Fondo con viñeta cibernética y retícula Direct2D */}
      <div
        className="pointer-events-none fixed inset-0"
        style={{
          // galaxia: nebulosas violeta / cian / azul del logo + campo de estrellas
          backgroundImage: [
            'radial-gradient(1px 1px at 20px 30px, rgba(255,255,255,0.55), transparent)',
            'radial-gradient(1px 1px at 95px 125px, rgba(201,184,255,0.6), transparent)',
            'radial-gradient(1.5px 1.5px at 165px 62px, rgba(198,247,255,0.55), transparent)',
            'radial-gradient(1px 1px at 140px 170px, rgba(255,255,255,0.4), transparent)',
            'radial-gradient(70rem 46rem at 0% 0%, rgba(138,77,255,0.30), transparent 70%)',
            'radial-gradient(70rem 46rem at 100% 100%, rgba(25,217,255,0.20), transparent 70%)',
            'radial-gradient(60rem 30rem at 50% 105%, rgba(61,91,255,0.24), transparent 70%)',
            'radial-gradient(ellipse at top, rgba(13,15,44,0.8), #05060F 60%, #03030F)',
          ].join(','),
          backgroundSize: '190px 190px, 230px 230px, 310px 310px, 270px 270px, auto, auto, auto, auto',
        }}
      />
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.04]"
        style={{
          backgroundImage: `linear-gradient(#19D9FF 1px, transparent 1px), linear-gradient(90deg, #19D9FF 1px, transparent 1px)`,
          backgroundSize: '44px 44px',
        }}
      />

      {/* Barra de Navegación Superior */}
      <header className="relative z-20 flex h-16 items-center justify-between border-b border-[#2D3375]/60 bg-[#0B0D27]/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-lg border border-[#19D9FF]/40 bg-[#05060F] shadow-[0_0_15px_rgba(25,217,255,0.25)]">
            <JasWaveAppIcon className="size-5 text-[#19D9FF]" />
          </div>
          <div>
            <span className="text-sm font-bold tracking-widest uppercase">
              <span className="text-[#D6D9EE]">JAS</span>
              <span className="bg-gradient-to-r from-[#8A4DFF] via-[#3D5BFF] to-[#19D9FF] bg-clip-text text-transparent">WAVE</span>
            </span>
            <span className="ml-2 rounded border border-[#19D9FF]/30 bg-[#19D9FF]/10 px-1.5 py-0.5 text-[9px] font-mono tracking-wider text-[#19D9FF]">
              STUDIO PWA
            </span>
          </div>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-xs text-[#9AA3DA]">
          <a href="#catalogo" className="transition-colors hover:text-[#19D9FF]">
            Catálogo VSTs
          </a>
          <a href="#planes" className="transition-colors hover:text-[#19D9FF]">
            Planes & Licencias
          </a>
          <a href="#compatibilidad" className="transition-colors hover:text-[#19D9FF]">
            Reaper & DAW Host
          </a>
        </nav>

        <div className="flex items-center gap-3">
          {cargando ? (
            <span className="text-xs text-[#5C6399]">Verificando sesión…</span>
          ) : session ? (
            <div className="flex items-center gap-2">
              {esAdmin && (
                <button
                  type="button"
                  onClick={() => void abrirAppAdmin()}
                  title="Abrir JasWave Admin (app aparte)"
                  className="flex items-center gap-1 rounded border border-fuchsia-500/50 bg-fuchsia-500/10 px-2.5 py-1 text-xs font-semibold text-fuchsia-300 shadow-[0_0_10px_rgba(224,82,255,0.25)] hover:bg-fuchsia-500/20"
                >
                  <Settings className="size-3" />
                  Admin
                </button>
              )}
              <div className="hidden sm:flex flex-col text-right">
                <span className="text-xs font-medium text-[#B6E8FF] truncate max-w-[140px]">{session.user.email}</span>
                <span className="text-[10px] text-[#19D9FF] font-mono">{nivelLicencia}</span>
              </div>
              <button
                type="button"
                onClick={() => void cerrarSesion()}
                title="Cerrar sesión"
                className="rounded-md border border-[#2D3375] bg-[#05060F] p-1.5 text-[#9AA3DA] hover:border-red-500/50 hover:text-red-400"
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
              className="flex items-center gap-1.5 rounded border border-[#19D9FF]/50 bg-[#19D9FF]/10 px-3 py-1.5 text-xs font-medium text-[#19D9FF] transition-all hover:bg-[#19D9FF]/20 hover:shadow-[0_0_12px_rgba(25,217,255,0.3)]"
            >
              <LogIn className="size-3.5" />
              Iniciar Sesión
            </button>
          )}

          <button
            type="button"
            onClick={manejarClickEntrar}
            className="flex items-center gap-1.5 rounded bg-gradient-to-r from-[#8A4DFF] via-[#3D5BFF] to-[#19D9FF] px-4 py-1.5 text-xs font-semibold text-white shadow-[0_0_15px_rgba(61,91,255,0.5)] transition-all hover:brightness-110 active:scale-95"
          >
            Ir al DAW
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </header>

      {/* Hero Section */}
      <section className="relative z-10 mx-auto max-w-5xl px-6 pt-16 pb-12 text-center md:pt-24">
        <JasWaveLogo className="mx-auto mb-4 h-40 w-auto max-w-full mix-blend-screen sm:h-52" alt="JasWave · AI Music Production DAW" />
        <div className="inline-flex items-center gap-2 rounded-full border border-[#19D9FF]/30 bg-[#0B0D27]/90 px-3 py-1 text-xs text-[#DCE0FA] mb-6 backdrop-blur-sm">
          <Zap className="size-3.5 text-[#19D9FF]" />
          <span>Arquitectura Híbrida: Direct2D C++ Nativo + WebAudio PWA</span>
        </div>

        <h1 className="text-4xl font-extrabold tracking-tight text-white sm:text-6xl sm:leading-none">
          CREA MÚSICA SIN LÍMITES EN{' '}
          <span className="bg-gradient-to-r from-[#8A4DFF] via-[#3D5BFF] to-[#19D9FF] bg-clip-text text-transparent drop-shadow-[0_0_30px_rgba(61,91,255,0.5)]">
            JASWAVE STUDIO
          </span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl text-sm leading-relaxed text-[#9AA3DA] sm:text-base">
          El primer DAW modular futurista con suite de plugins VST3 unificada. Diseñado para ejecutarse en tu navegador
          con latencia cero o como plugins nativos dentro de Reaper, Ableton Live y FL Studio.
        </p>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
          <button
            type="button"
            onClick={manejarClickEntrar}
            className="flex items-center gap-2 rounded-lg bg-[#19D9FF] px-6 py-3 text-sm font-bold text-[#05060F] shadow-[0_0_25px_rgba(25,217,255,0.5)] transition-all hover:bg-[#DCE0FA] hover:scale-105 active:scale-95"
          >
            <Music4 className="size-4" />
            Entrar al Estudio (DAW)
          </button>

          <a
            href="#catalogo"
            className="flex items-center gap-2 rounded-lg border border-[#2D3375] bg-[#0B0D27]/80 px-6 py-3 text-sm font-medium text-[#B6E8FF] transition-all hover:border-[#19D9FF]/50 hover:bg-[#0B0D27]"
          >
            Explorar Catálogo VST3
          </a>
        </div>

        {/* Estado de acceso */}
        <div className="mt-6 text-xs text-[#5C6399]">
          {session ? (
            <span className="text-emerald-400">● Conectado como {session.user.email} (Acceso Autorizado)</span>
          ) : (
            <span>● Requiere cuenta JasWave para sincronización y desbloqueo de audio.</span>
          )}
        </div>
      </section>

      {/* Sección Catálogo de Plugins */}
      <section id="catalogo" className="relative z-10 mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-[#2D3375] pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-wider text-[#DCE0FA] uppercase">Catálogo de Plugins VST3</h2>
            <p className="text-xs text-[#9AA3DA]">Plugins nativos y módulos web listos para producción profesional.</p>
          </div>

          <div className="flex gap-2">
            {(['todos', 'efectos', 'instrumentos'] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setFiltroCategoria(cat)}
                className={`rounded px-3 py-1 text-xs font-medium uppercase transition-colors ${
                  filtroCategoria === cat
                    ? 'border border-[#19D9FF]/60 bg-[#19D9FF]/20 text-[#19D9FF]'
                    : 'border border-transparent text-[#9AA3DA] hover:text-[#B6E8FF]'
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
                className="group relative flex flex-col justify-between rounded-xl border border-[#2D3375] bg-[#0B0D27]/90 p-5 shadow-lg transition-all hover:border-[#19D9FF]/60 hover:shadow-[0_0_20px_rgba(25,217,255,0.15)]"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="flex size-10 items-center justify-center rounded-lg border border-[#19D9FF]/30 bg-[#05060F] text-[#19D9FF] group-hover:shadow-[0_0_12px_rgba(25,217,255,0.3)]">
                      <Icono className="size-5" />
                    </div>
                    <span className="rounded border border-[#2D3375] bg-[#05060F] px-2 py-0.5 text-[10px] font-mono text-[#DCE0FA]">
                      {plugin.incluidoEn}
                    </span>
                  </div>

                  <h3 className="mt-4 text-base font-bold text-white group-hover:text-[#DCE0FA] transition-colors">
                    {plugin.nombre}
                  </h3>
                  <p className="text-[11px] font-mono text-[#19D9FF]">{plugin.tipo}</p>
                  <p className="mt-2 text-xs leading-relaxed text-[#9AA3DA]">{plugin.desc}</p>
                </div>

                <div className="mt-4 pt-4 border-t border-[#2D3375]/50">
                  <div className="flex flex-wrap gap-1.5">
                    {plugin.badges.map((b) => (
                      <span key={b} className="rounded bg-[#05060F] px-2 py-0.5 text-[9px] text-[#B6E8FF]">
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
          <h2 className="text-2xl font-bold tracking-wider text-[#DCE0FA] uppercase">Planes y Licencias JasWave</h2>
          <p className="mt-2 text-xs text-[#9AA3DA]">
            Elige el nivel de potencia adecuado para tu estudio. Todos los planes incluyen acceso completo al DAW Web.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {/* Plan Gratuito */}
          <div className="flex flex-col justify-between rounded-xl border border-[#2D3375] bg-[#0B0D27]/80 p-6 backdrop-blur-sm">
            <div>
              <span className="text-xs font-mono text-[#9AA3DA] uppercase">Comunidad</span>
              <h3 className="text-xl font-bold text-white mt-1">Gratuita</h3>
              <div className="mt-3 text-2xl font-extrabold text-[#DCE0FA]">$0</div>
              <p className="mt-2 text-xs text-[#9AA3DA]">Para productores que inician en el ecosistema JasWave.</p>

              <ul className="mt-6 space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> Acceso completo al DAW Web y Desktop
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> EQ Paramétrico (4 bandas)
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> Compresor de canal básico
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> Piano Synth acústico (16 voces)
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={manejarClickEntrar}
              className="mt-8 w-full rounded border border-[#19D9FF]/50 bg-[#19D9FF]/10 py-2.5 text-xs font-semibold text-[#19D9FF] hover:bg-[#19D9FF]/20"
            >
              Comenzar Gratis
            </button>
          </div>

          {/* Plan Pro */}
          <div className="relative flex flex-col justify-between rounded-xl border-2 border-[#19D9FF] bg-[#0B0D27] p-6 shadow-[0_0_30px_rgba(25,217,255,0.2)]">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full border border-[#19D9FF] bg-[#05060F] px-3 py-0.5 text-[10px] font-bold text-[#19D9FF] uppercase">
              Más Popular
            </div>
            <div>
              <span className="text-xs font-mono text-[#19D9FF] uppercase">Estudio</span>
              <h3 className="text-xl font-bold text-white mt-1">Pro Creator</h3>
              <div className="mt-3 text-2xl font-extrabold text-[#DCE0FA]">
                $9.99 <span className="text-xs font-normal text-[#9AA3DA]">/ mes</span>
              </div>
              <p className="mt-2 text-xs text-[#9AA3DA]">Para mezcla profesional, masterización y streaming.</p>

              <ul className="mt-6 space-y-2 text-xs text-slate-300">
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> Todo lo incluido en Gratuita
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> EQ dinámico de hasta 24 bandas
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> Bus Compressor VCA + Sidechain HPF
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> TruePeak Limiter 8× + LUFS
                </li>
                <li className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#19D9FF]" /> Guardado y sincronización en la nube
                </li>
              </ul>
            </div>

            <button
              type="button"
              onClick={manejarClickEntrar}
              className="mt-8 w-full rounded bg-[#19D9FF] py-2.5 text-xs font-bold text-[#05060F] shadow-[0_0_15px_rgba(25,217,255,0.4)] hover:bg-[#DCE0FA]"
            >
              Obtener Pro
            </button>
          </div>

          {/* Plan Ultra */}
          <div className="flex flex-col justify-between rounded-xl border border-[#2D3375] bg-[#0B0D27]/80 p-6 backdrop-blur-sm">
            <div>
              <span className="text-xs font-mono text-purple-400 uppercase">Suite Completa</span>
              <h3 className="text-xl font-bold text-white mt-1">Ultra Suite</h3>
              <div className="mt-3 text-2xl font-extrabold text-[#DCE0FA]">
                $19.99 <span className="text-xs font-normal text-[#9AA3DA]">/ mes</span>
              </div>
              <p className="mt-2 text-xs text-[#9AA3DA]">Acceso sin restricciones para DAWs externos y masterización.</p>

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
      <footer className="relative z-10 border-t border-[#2D3375]/50 bg-[#03030F] px-6 py-8 text-center text-xs text-[#5C6399]">
        <p>© 2026 JasWave Audio Workstation. Desarrollado con Direct2D C++, WebAudio y Supabase.</p>
        <p className="mt-1 text-[10px]">Todos los plugins VST3 son marcas registradas de JasWave Audio Technologies.</p>
      </footer>

      {/* Modal de Autenticación (Login / Registro) */}
      {modalAuthAbierto && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-sm rounded-xl border border-[#19D9FF]/40 bg-[#0B0D27] p-6 shadow-[0_0_40px_rgba(25,217,255,0.2)]">
            <button
              type="button"
              onClick={() => setModalAuthAbierto(false)}
              className="absolute top-4 right-4 text-[#9AA3DA] hover:text-white"
            >
              <X className="size-4" />
            </button>

            <div className="flex items-center gap-2 mb-4">
              <JasWaveAppIcon className="size-5 text-[#19D9FF]" />
              <h3 className="text-base font-bold text-white uppercase tracking-wider">
                {modoAuth === 'login' ? 'Iniciar Sesión' : 'Crear Cuenta'}
              </h3>
            </div>

            <p className="text-xs text-[#9AA3DA] mb-4">
              {modoAuth === 'login'
                ? 'Ingresa tus credenciales para acceder a tu estudio y activar tus plugins VST3.'
                : 'Crea tu cuenta gratuita de JasWave para acceder al DAW y obtener tu licencia base.'}
            </p>

            <form onSubmit={manejarAuth} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-[#B6E8FF] mb-1">Correo Electrónico</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="usuario@ejemplo.com"
                  className="w-full rounded border border-[#2D3375] bg-[#05060F] px-3 py-2 text-xs text-white placeholder-[#5C6399] focus:border-[#19D9FF] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-[#B6E8FF] mb-1">Contraseña</label>
                <div className="relative">
                  <input
                    type={mostrarPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded border border-[#2D3375] bg-[#05060F] pl-3 pr-10 py-2 text-xs text-white placeholder-[#5C6399] focus:border-[#19D9FF] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMostrarPassword((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#9AA3DA] hover:text-[#19D9FF] transition-colors"
                    title={mostrarPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                  >
                    {mostrarPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </div>

              {authError && (
                <div className="rounded border border-red-500/40 bg-red-500/10 p-2 text-[11px] text-red-300">
                  {authError}
                </div>
              )}

              <button
                type="submit"
                disabled={authEnviando}
                className="w-full rounded bg-[#19D9FF] py-2 text-xs font-bold text-[#05060F] shadow-[0_0_15px_rgba(25,217,255,0.3)] hover:bg-[#DCE0FA] transition-all disabled:opacity-50"
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
                className="text-xs text-[#19D9FF] hover:underline"
              >
                {modoAuth === 'login' ? '¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Inicia sesión'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}
